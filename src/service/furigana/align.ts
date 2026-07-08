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
// (surface_form + katakana reading) structurally satisfies this, so production
// passes the real tokenizer; tests pass a fake.
export interface AlignToken {
  surface_form: string
  reading?: string
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

// Produce the kana-bearing segments for ONE kanji-containing token. Non-kanji
// portions (okurigana) are intentionally omitted — they become bare via
// gap-filling in alignLine.
function alignToken(
  surface: string,
  tStart: number,
  readingHira: string | undefined,
  lookup: NonNullable<AlignDeps['lookup']>,
  isNonSplittable: NonNullable<AlignDeps['isNonSplittable']>,
): RubyLineSegment[] {
  // No reliable reading -> cannot annotate; leave the kanji bare.
  if (!readingHira) return []

  const parts = lookup(surface, readingHira)

  if (parts && parts.length > 0) {
    const ranges = partRanges(parts)

    if (isNonSplittable(parts)) {
      // Jukujikun/ateji: reading cannot be attributed to individual kanji, so
      // emit ONE whole-group segment over its kanji-bearing parts.
      const rtParts = ranges.filter(
        (r) => r.part.rt && hasKanji(r.part.ruby),
      )
      if (rtParts.length > 0) {
        const kana = rtParts.map((r) => r.part.rt).join('')
        return [
          {
            charStart: tStart + rtParts[0].start,
            charEnd: tStart + rtParts[rtParts.length - 1].end,
            kana,
            nonSplittable: true,
          },
        ]
      }
    } else {
      // Splittable: one per-kanji entry per reading-bearing kanji part.
      const perKanji: NonNullable<RubyLineSegment['perKanji']> = []
      for (const r of ranges) {
        const rt = r.part.rt
        if (rt && hasKanji(r.part.ruby)) {
          perKanji.push({
            charStart: tStart + r.start,
            charEnd: tStart + r.end,
            kana: rt,
          })
        }
      }
      if (perKanji.length > 0) {
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
    }
  }

  // OOV (no jmdict entry) — best-effort: strip the okurigana the surface already
  // spells out from the reading so the kanji span keeps only its own reading
  // (e.g. conjugated 立った → 立=た, not たった; 引っ… → 引=ひ, not ひっ), then
  // attach it as a non-splittable group. Never throws.
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
        lookup,
        isNonSplittable,
      ),
    )
  }

  return { segments: fillBare(line, kanjiSegments) }
}
