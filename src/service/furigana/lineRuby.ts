import type { RubyLineModel, RubyLineSegment } from '@/types/furigana'
import { groupReadings, mergeCollidingSegments } from './grouping'

// Line-char coordinates below are JS string (code-unit) indices with an
// INCLUSIVE end, matching alignLine (align.ts:124 emits
// `charEnd = tStart + tokenLen - 1`) and reconcile.ts (reconcile.ts:10): the
// text a range [start, end] covers is `text.slice(start, end + 1)`.
// buildLineRenderSpans and buildCells convert to an exclusive end
// (`charEnd + 1`) at the boundary before slicing.

// One tile of a splittable span: a kana-bearing kanji cell or a bare gap char
// (okurigana / non-kanji, kana undefined).
export interface LineRubyCell {
  text: string
  kana?: string
}

// One ordered piece of a rendered line: a bare text run (kana and cells
// undefined), a jukujikun group (kana set, cells undefined), or a splittable
// unit (kana set, cells tile `text`).
export interface LineRenderSpan {
  text: string
  kana?: string
  cells?: LineRubyCell[]
}

// react-lrc's clrc parser captures the single space after "]" from the
// synthesized "[mm:ss.ss] value" lines (see src/service/lyrics.ts:258-263), so
// line.content is " " + line.value. Strip exactly ONE leading space; never trim
// (any further leading whitespace belongs to the original line value).
export function normalizeLrcContent(content: string): string {
  return content.startsWith(' ') ? content.slice(1) : content
}

// Tile a splittable segment's [start, end) slice into ruby cells: a kana-bearing
// cell over each reading group plus a bare cell for every okurigana / non-kanji
// gap (leading, internal, or trailing). Adjacent per-kanji readings that would
// overhang into each other are first merged into a single group-ruby cell via
// groupReadings — the SAME collision model the word-level path uses (see
// ruby-cue-content.tsx / grouping.ts) — so a wide reading like じょう over a
// single-width 丈 no longer overlaps its neighbour's reading (大丈夫 →
// {大丈: だいじょう} + {夫: ぶ} instead of three colliding cells). unitStart = 0
// keeps the returned start/end in line-char space with the same inclusive end as
// the perKanji spans align.ts emits. Overlapping or zero-width entries are
// dropped (keep first) so the invariant
// cells.map(c => c.text).join('') === text.slice(start, end) always holds.
function buildCells(
  text: string,
  start: number,
  end: number,
  perKanji: NonNullable<RubyLineSegment['perKanji']>,
): LineRubyCell[] {
  const sorted = [...perKanji].sort((a, b) => a.charStart - b.charStart)
  const groups = groupReadings(sorted, 0)

  const cells: LineRubyCell[] = []
  let local = start
  for (const g of groups) {
    const gStart = Math.max(start, g.start)
    // g.end is inclusive (line-char); convert to an exclusive slice end.
    const gEnd = Math.min(end, g.end + 1)
    if (gEnd <= gStart || gStart < local) continue
    if (gStart > local) cells.push({ text: text.slice(local, gStart) })
    cells.push({ text: text.slice(gStart, gEnd), kana: g.kana })
    local = gEnd
  }
  if (local < end) cells.push({ text: text.slice(local, end) })
  return cells
}

// Cue-free analogue of reconcile(): flatten a line's ruby model into ordered
// render spans over the raw line text. Splittable segments carry per-kanji
// `cells`; jukujikun (nonSplittable) and kana-less runs carry none. Adjacent
// segments whose boundary readings would overhang are first merged
// (mergeCollidingSegments) so a cross-word collision group-ruby's like a
// within-word one. Segments are clamped to the line, overlapping ones drop (keep
// first), and gaps fill with bare spans, so spans.map(s => s.text).join('') ===
// text for non-empty input. Pure — never mutates `model`.
export function buildLineRenderSpans(
  text: string,
  model: RubyLineModel | undefined,
): LineRenderSpan[] {
  if (text === '') return []
  if (!model || model.segments.length === 0) return [{ text }]

  const segments = mergeCollidingSegments(
    [...model.segments].sort((a, b) => a.charStart - b.charStart),
  )
  const spans: LineRenderSpan[] = []
  let cursor = 0

  for (const seg of segments) {
    const start = Math.max(0, seg.charStart)
    // seg.charEnd is inclusive (align.ts); convert to an exclusive slice end.
    const end = Math.min(text.length, seg.charEnd + 1)
    if (end <= start || start < cursor) continue

    if (start > cursor) spans.push({ text: text.slice(cursor, start) })
    cursor = start

    const slice = text.slice(start, end)
    const kana = seg.kana
    const kanaPresent = kana !== undefined && kana !== ''
    const perKanji = seg.perKanji
    const hasPerKanji = perKanji !== undefined && perKanji.length > 0

    if (!kanaPresent && !hasPerKanji) {
      spans.push({ text: slice })
    } else if (
      seg.nonSplittable === true ||
      !perKanji ||
      perKanji.length === 0
    ) {
      spans.push({ text: slice, kana })
    } else {
      spans.push({
        text: slice,
        kana,
        cells: buildCells(text, start, end, perKanji),
      })
    }
    cursor = end
  }

  if (cursor < text.length) spans.push({ text: text.slice(cursor) })
  return spans
}
