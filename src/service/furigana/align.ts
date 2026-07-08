import type {
  RubyLineModel,
  RubyLineSegment,
  RubyPart,
} from '@/types/furigana'
import { hasKanji, isKanji, katakanaToHiragana } from '@/utils/kana'
import {
  isNonSplittable as jmdictIsNonSplittable,
  lookup as jmdictLookup,
} from './jmdictFurigana'

// Minimal token shape this module reads. A real @patdx/kuromoji IpadicFeatures
// (surface_form + katakana reading + dictionary basic_form) structurally
// satisfies this, so production passes the real tokenizer; tests pass a fake.
export interface AlignToken {
  surface_form: string
  reading?: string
  basic_form?: string
}

export interface TokenizerLike {
  tokenize(text: string): AlignToken[]
}

// Injectable jmdict dependencies. Default to the real singleton; tests inject a
// fixture-backed lookup so no real dictionary (or network) is touched.
export interface AlignDeps {
  lookup?: (surface: string, hiraganaReading: string) => RubyPart[] | undefined
  isNonSplittable?: (parts: RubyPart[]) => boolean
}

// kuromoji emits readings in katakana (or '*'/empty for unknowns/punctuation).
// Convert to hiragana for the <rt>; treat a missing/placeholder reading as none.
function toHiragana(reading?: string): string | undefined {
  if (!reading || reading === '*') return undefined
  return katakanaToHiragana(reading)
}

// jmdict furigana parts concatenate to the whole entry text, so their code-unit
// offsets within the token can be accumulated in one pass.
interface PartRange {
  part: RubyPart
  start: number
  end: number
}

function partRanges(parts: RubyPart[]): PartRange[] {
  const ranges: PartRange[] = []
  let offset = 0
  for (const part of parts) {
    const len = part.ruby.length
    ranges.push({ part, start: offset, end: offset + len - 1 })
    offset += len
  }
  return ranges
}

// First and last kanji code-unit indices within `surface`, or null if none.
function kanjiSpan(surface: string): { first: number; last: number } | null {
  let first = -1
  let last = -1
  let i = 0
  while (i < surface.length) {
    const cp = surface.codePointAt(i)!
    const units = cp > 0xffff ? 2 : 1
    if (isKanji(cp)) {
      if (first < 0) first = i
      last = i + units - 1
    }
    i += units
  }
  return first < 0 ? null : { first, last }
}

// Emit the kana-bearing segment(s) for ONE jmdict-furigana entry's parts,
// anchored at `tStart`. A jukujikun/ateji entry (isNonSplittable) yields ONE
// whole-group segment whose reading cannot be split per kanji; a splittable
// entry yields one segment carrying a perKanji span per reading-bearing kanji.
// Non-kanji parts (okurigana) are dropped so alignLine's gap-filling makes them
// bare. Empty when no part carries a kanji reading.
function segmentsFromParts(
  parts: RubyPart[],
  tStart: number,
  isNonSplittable: NonNullable<AlignDeps['isNonSplittable']>,
): RubyLineSegment[] {
  const ranges = partRanges(parts)

  if (isNonSplittable(parts)) {
    const rtParts = ranges.filter((r) => r.part.rt && hasKanji(r.part.ruby))
    if (rtParts.length === 0) return []
    return [
      {
        charStart: tStart + rtParts[0].start,
        charEnd: tStart + rtParts[rtParts.length - 1].end,
        kana: rtParts.map((r) => r.part.rt).join(''),
        nonSplittable: true,
      },
    ]
  }

  const perKanji: NonNullable<RubyLineSegment['perKanji']> = []
  for (const r of ranges) {
    const rt = r.part.rt
    if (rt && hasKanji(r.part.ruby)) {
      perKanji.push({ charStart: tStart + r.start, charEnd: tStart + r.end, kana: rt })
    }
  }
  if (perKanji.length === 0) return []
  return [
    {
      charStart: perKanji[0].charStart,
      charEnd: perKanji[perKanji.length - 1].charEnd,
      kana: perKanji.map((p) => p.kana).join(''),
      nonSplittable: false,
      perKanji,
    },
  ]
}

// Derive a conjugated word's DICTIONARY-form reading from its surface reading by
// swapping the trailing okurigana. A surface and its basic_form share a leading
// stem that carries every kanji; only the trailing kana differ, and okurigana
// reads as itself — so stemReading = surfaceReading minus the surface okurigana
// tail, and the dict reading = stemReading + the basic_form okurigana tail.
// Returns undefined when the swap is unsafe: no usable basic_form, a tail that
// carries kanji, or a surface reading that doesn't end with its okurigana tail
// (irregular stems like 来る/来た whose kanji reading shifts across conjugation),
// leaving such tokens to the OOV heuristic below.
function deriveBasicReading(
  surface: string,
  basicForm: string | undefined,
  surfaceReading: string,
): string | undefined {
  if (!basicForm || basicForm === '*' || basicForm === surface) return undefined
  let stem = 0
  const max = Math.min(surface.length, basicForm.length)
  while (stem < max && surface[stem] === basicForm[stem]) stem++
  const surfaceTail = surface.slice(stem)
  const basicTail = basicForm.slice(stem)
  if (hasKanji(surfaceTail) || hasKanji(basicTail)) return undefined
  if (surfaceTail && !surfaceReading.endsWith(surfaceTail)) return undefined
  const stemReading = surfaceTail
    ? surfaceReading.slice(0, surfaceReading.length - surfaceTail.length)
    : surfaceReading
  return stemReading + basicTail || undefined
}

// Produce the kana-bearing segments for ONE kanji-containing token, trying three
// tiers in order: (1) surface-form jmdict lookup, whose key includes kuromoji's
// contextual reading so it disambiguates homographs; (2) dictionary-form lookup
// for conjugated words that miss under their surface — every kanji sits in the
// stem shared with the surface, so the entry's per-kanji offsets map straight
// onto the surface; (3) an OOV heuristic that strips the okurigana the surface
// spells out. Non-kanji portions are omitted and become bare via alignLine's
// gap-filling.
function alignToken(
  surface: string,
  tStart: number,
  readingHira: string | undefined,
  basicForm: string | undefined,
  lookup: NonNullable<AlignDeps['lookup']>,
  isNonSplittable: NonNullable<AlignDeps['isNonSplittable']>,
): RubyLineSegment[] {
  if (!readingHira) return []

  const surfaceParts = lookup(surface, readingHira)
  if (surfaceParts && surfaceParts.length > 0) {
    const segs = segmentsFromParts(surfaceParts, tStart, isNonSplittable)
    if (segs.length > 0) return segs
  }

  const basicReading = deriveBasicReading(surface, basicForm, readingHira)
  if (basicForm && basicReading) {
    const basicParts = lookup(basicForm, basicReading)
    if (basicParts && basicParts.length > 0) {
      const segs = segmentsFromParts(basicParts, tStart, isNonSplittable)
      if (segs.length > 0) return segs
    }
  }

  // OOV — strip the okurigana the surface already spells out from the reading so
  // the kanji span keeps only its own reading (e.g. 立った → 立=た, not たった;
  // 引っ… → 引=ひ, not ひっ), then attach it as a non-splittable group.
  const span = kanjiSpan(surface)
  if (!span) return []
  const leadingKana = surface.slice(0, span.first)
  const trailingKana = surface.slice(span.last + 1)
  let kana = readingHira
  if (trailingKana && kana.endsWith(trailingKana)) {
    kana = kana.slice(0, kana.length - trailingKana.length)
  }
  if (leadingKana && kana.startsWith(leadingKana)) {
    kana = kana.slice(leadingKana.length)
  }
  if (!kana) return []
  return [
    {
      charStart: tStart + span.first,
      charEnd: tStart + span.last,
      kana,
      nonSplittable: true,
    },
  ]
}

// Fill every char not covered by a kanji segment with a bare segment so the
// returned model covers the whole line in order (no gaps, no overlaps).
function fillBare(
  line: string,
  kanjiSegments: RubyLineSegment[],
): RubyLineSegment[] {
  const covered = new Array<boolean>(line.length).fill(false)
  for (const seg of kanjiSegments) {
    const start = Math.max(0, seg.charStart)
    const end = Math.min(line.length - 1, seg.charEnd)
    for (let i = start; i <= end; i++) covered[i] = true
  }

  const bare: RubyLineSegment[] = []
  let runStart = -1
  for (let i = 0; i < line.length; i++) {
    if (!covered[i]) {
      if (runStart < 0) runStart = i
    } else if (runStart >= 0) {
      bare.push({ charStart: runStart, charEnd: i - 1, nonSplittable: false })
      runStart = -1
    }
  }
  if (runStart >= 0) {
    bare.push({ charStart: runStart, charEnd: line.length - 1, nonSplittable: false })
  }

  return [...kanjiSegments, ...bare].sort((a, b) => a.charStart - b.charStart)
}

// Align a full line into a per-kanji ruby model. Tokenizes the WHOLE line for
// context-aware readings, resolves per-kanji spans via jmdict-furigana, and
// falls back to even distribution for out-of-vocabulary kanji. Pure aside from
// the injected tokenizer/lookup.
export function alignLine(
  line: string,
  tokenizer: TokenizerLike,
  deps: AlignDeps = {},
): RubyLineModel {
  const lookup = deps.lookup ?? jmdictLookup
  const isNonSplittable = deps.isNonSplittable ?? jmdictIsNonSplittable

  const kanjiSegments: RubyLineSegment[] = []
  let searchFrom = 0
  for (const token of tokenizer.tokenize(line)) {
    const surface = token.surface_form
    if (!surface) continue

    // Position the token in the line by scanning forward; robust to whatever
    // 1-based char offset the tokenizer reports (and to repeated surfaces).
    let tStart = line.indexOf(surface, searchFrom)
    if (tStart < 0) tStart = searchFrom
    searchFrom = tStart + surface.length

    if (!hasKanji(surface)) continue

    kanjiSegments.push(
      ...alignToken(
        surface,
        tStart,
        toHiragana(token.reading),
        token.basic_form,
        lookup,
        isNonSplittable,
      ),
    )
  }

  return { segments: fillBare(line, kanjiSegments) }
}
