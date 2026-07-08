// Mirrors jmdict-furigana JSON schema: { text, reading, furigana: [{ ruby, rt? }] }
// IMPORTANT: there is NO `splittable` field — infer non-splittability structurally.
export interface RubyPart {
  ruby: string // kanji text this part covers
  rt?: string // hiragana reading (undefined = bare, no annotation)
}

// Line-level ruby model in line-char coordinates (output of alignLine)
export interface RubyLineSegment {
  charStart: number
  charEnd: number
  kana?: string // hiragana reading for the whole segment (if kanji)
  nonSplittable: boolean // true = whole group reads as one unit (jukujikun)
  perKanji?: Array<{ charStart: number; charEnd: number; kana: string }>
}

export interface RubyLineModel {
  segments: RubyLineSegment[]
}

// Cue-reconciled render unit (output of reconcile)
export interface RenderUnit {
  charStart: number
  charEnd: number
  kanjiText: string
  kana?: string // undefined = bare text, no ruby
  nonSplittable: boolean
  coveringCueIdx: number[] // 1 element for single-cue; 2+ for straddling jukujikun
}

// Stable DOM ref key for per-unit refs (extends existing wordRef key scheme)
// Existing: `${lineIdx}|${cueLineKey}|${cueIdx}`
// Extended: `${lineIdx}|${cueLineKey}|${cueIdx}|u${unitIdx}`
export function rubyUnitKey(
  lineIdx: number,
  cueLineKey: string,
  cueIdx: number,
  unitIdx: number,
): string {
  return `${lineIdx}|${cueLineKey}|${cueIdx}|u${unitIdx}`
}

// data-testid convention for Cypress targeting
// word-unit-{lineIdx}-{cueLineKey}-{cueIdx}-{unitIdx}
export function rubyUnitTestId(
  lineIdx: number,
  cueLineKey: string,
  cueIdx: number,
  unitIdx: number,
): string {
  return `word-unit-${lineIdx}-${cueLineKey}-${cueIdx}-${unitIdx}`
}
