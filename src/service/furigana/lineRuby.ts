import type { RubyLineModel, RubyLineSegment } from '@/types/furigana'

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

// Tile a splittable segment's [start, end) slice into per-kanji cells: a
// kana-bearing cell over each perKanji kanji plus a bare cell for every
// okurigana / non-kanji gap (leading, internal, or trailing). Overlapping or
// zero-width perKanji entries are dropped (keep first) so the invariant
// cells.map(c => c.text).join('') === text.slice(start, end) always holds.
function buildCells(
  text: string,
  start: number,
  end: number,
  perKanji: NonNullable<RubyLineSegment['perKanji']>,
): LineRubyCell[] {
  const cells: LineRubyCell[] = []
  const sorted = [...perKanji].sort((a, b) => a.charStart - b.charStart)
  let local = start
  for (const pk of sorted) {
    const pkStart = Math.max(start, pk.charStart)
    // pk.charEnd is inclusive (align.ts); convert to an exclusive slice end.
    const pkEnd = Math.min(end, pk.charEnd + 1)
    if (pkEnd <= pkStart || pkStart < local) continue
    if (pkStart > local) cells.push({ text: text.slice(local, pkStart) })
    cells.push({ text: text.slice(pkStart, pkEnd), kana: pk.kana })
    local = pkEnd
  }
  if (local < end) cells.push({ text: text.slice(local, end) })
  return cells
}

// Cue-free analogue of reconcile(): flatten a line's ruby model into ordered
// render spans over the raw line text. Splittable segments carry per-kanji
// `cells`; jukujikun (nonSplittable) and kana-less runs carry none. Segments are
// clamped to the line, overlapping ones drop (keep first), and gaps fill with
// bare spans, so spans.map(s => s.text).join('') === text for non-empty input.
// Pure — never mutates `model`.
export function buildLineRenderSpans(
  text: string,
  model: RubyLineModel | undefined,
): LineRenderSpan[] {
  if (text === '') return []
  if (!model || model.segments.length === 0) return [{ text }]

  const segments = [...model.segments].sort((a, b) => a.charStart - b.charStart)
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
