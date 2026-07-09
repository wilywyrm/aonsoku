import type {
  RubyLineModel,
  RubyLineSegment,
  RubyPart,
} from '@/types/furigana'
import {
  hasKanji,
  isKanji,
  katakanaToHiragana,
  segmentScriptRuns,
} from '@/utils/kana'
import {
  isNonSplittable as jmdictIsNonSplittable,
  lookup as jmdictLookup,
} from './jmdictFurigana'

// Minimal token shape this module reads. A kuromoji IpadicFeatures (surface_form
// + katakana reading + basic_form) satisfies this; a Lindera/UniDic token also
// supplies lemmaReading (語彙素読み) so the dictionary-form lookup needs no
// okurigana-swap derivation. Production passes a real tokenizer; tests pass a fake.
export interface AlignToken {
  surface_form: string
  reading?: string
  basic_form?: string
  lemmaReading?: string
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

// Emit the kana-bearing segment for ONE jmdict-furigana entry's parts, anchored
// at `tStart` and spanning the whole token (`tokenLen` code units). A jukujikun/
// ateji entry (isNonSplittable) yields ONE group segment over just its kanji
// span, since its reading cannot be attributed per kanji. A splittable entry
// yields ONE segment spanning the FULL token with a perKanji span per reading-
// bearing kanji; okurigana between/around the kanji carry no ruby (rendered bare
// inside the span), so the whole word wipes as a single unit. Empty when no part
// carries a kanji reading.
function segmentsFromParts(
  parts: RubyPart[],
  tStart: number,
  tokenLen: number,
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
      charStart: tStart,
      charEnd: tStart + tokenLen - 1,
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

// Split an OOV reading across the surface's kanji runs, anchoring on the literal
// kana the surface itself spells out (okurigana/sokuon): each maximal kanji run
// takes the reading between the surrounding literal kana, and the literal kana
// are consumed as-is so they stay bare in the base text (真っ赤 / まっか -> 真=ま,
// 赤=か, っ bare). Returns null when the reading cannot be aligned to those kana
// (e.g. a fused reading like 学校 / がっこう), leaving the caller to group.
function alignOovByRuns(
  surface: string,
  tStart: number,
  reading: string,
  runs: ReturnType<typeof segmentScriptRuns>,
): NonNullable<RubyLineSegment['perKanji']> | null {
  const perKanji: NonNullable<RubyLineSegment['perKanji']> = []
  let rc = 0
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]
    const text = surface.slice(run.charStart, run.charEnd + 1)
    if (run.kind === 'other') {
      if (!reading.startsWith(text, rc)) return null
      rc += text.length
      continue
    }
    const next = runs[i + 1]
    let end: number
    if (next) {
      end = reading.indexOf(surface.slice(next.charStart, next.charEnd + 1), rc)
      if (end < 0) return null
    } else {
      end = reading.length
    }
    const chunk = reading.slice(rc, end)
    if (!chunk) return null
    perKanji.push({
      charStart: tStart + run.charStart,
      charEnd: tStart + run.charEnd,
      kana: chunk,
    })
    rc = end
  }
  if (rc !== reading.length || perKanji.length === 0) return null
  return perKanji
}

// Produce the kana-bearing segments for ONE kanji-containing token, trying three
// tiers in order: (1) surface-form jmdict lookup, whose key includes kuromoji's
// contextual reading so it disambiguates homographs; (2) dictionary-form lookup
// for conjugated words that miss under their surface; (3) an OOV heuristic that
// aligns the reading to the surface's script runs. Each hit is ONE segment
// spanning the whole token, so a word wipes as a single unit; okurigana/sokuon
// inside the span carry no ruby (rendered bare), per the mono-ruby convention.
function alignToken(
  surface: string,
  tStart: number,
  readingHira: string | undefined,
  basicForm: string | undefined,
  lemmaReadingHira: string | undefined,
  lookup: NonNullable<AlignDeps['lookup']>,
  isNonSplittable: NonNullable<AlignDeps['isNonSplittable']>,
): RubyLineSegment[] {
  if (!readingHira) return []

  const surfaceParts = lookup(surface, readingHira)
  if (surfaceParts && surfaceParts.length > 0) {
    const segs = segmentsFromParts(
      surfaceParts,
      tStart,
      surface.length,
      isNonSplittable,
    )
    if (segs.length > 0) return segs
  }

  // Dictionary-form lookup: prefer an explicit lemma reading (UniDic supplies
  // 語彙素読み directly), else derive one from the surface (kuromoji path).
  const basicReading =
    lemmaReadingHira ?? deriveBasicReading(surface, basicForm, readingHira)
  if (basicForm && basicReading) {
    const basicParts = lookup(basicForm, basicReading)
    if (basicParts && basicParts.length > 0) {
      const segs = segmentsFromParts(
        basicParts,
        tStart,
        surface.length,
        isNonSplittable,
      )
      if (segs.length > 0) return segs
    }
  }

  // OOV — align the reading to the surface's kanji/kana runs so any okurigana or
  // sokuon the surface spells out stays bare (真っ赤 -> 真=ま, っ bare, 赤=か),
  // yielding one splittable unit spanning the token.
  const runs = segmentScriptRuns(surface)
  if (runs.length > 1) {
    const perKanji = alignOovByRuns(surface, tStart, readingHira, runs)
    if (perKanji) {
      return [
        {
          charStart: tStart,
          charEnd: tStart + surface.length - 1,
          kana: perKanji.map((p) => p.kana).join(''),
          nonSplittable: false,
          perKanji,
        },
      ]
    }
  }

  // Fallback: a pure-kanji word (or a reading that would not align) becomes one
  // group over the kanji span, with leading/trailing okurigana stripped.
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
        toHiragana(token.lemmaReading),
        lookup,
        isNonSplittable,
      ),
    )
  }

  return { segments: fillBare(line, kanjiSegments) }
}
