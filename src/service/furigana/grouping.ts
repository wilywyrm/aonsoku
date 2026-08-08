import type { RenderUnit, RubyLineSegment } from '@/types/furigana'

// Furigana annotation size as a fraction of the base glyph (MUST match
// .ruby-furi-rt font-size in index.css: 0.5em). CJK base glyphs are full-width
// (1em) and each kana reading char is RT_EM em, so a reading's natural width is
// kana.length * RT_EM em — the basis for the collision test.
export const RT_EM = 0.5

// Minimum horizontal gap (em) required between two adjacent readings before
// they are treated as colliding. 0 == merge only when readings actually overlap
// (one overhangs into the other), so mono-ruby is preserved wherever readings
// merely sit edge-to-edge; raise it to force more breathing room.
export const READING_GAP_EM = 0

// One reading over a contiguous kanji span. start/end are inclusive char indices
// in whatever coordinate space the caller uses (unit-local for grouping within a
// unit, line-char for merging across units); readingsCollide only compares
// relative positions, so any consistent origin works. 1 em == 1 base char.
export interface ReadingSpan {
  start: number
  end: number
  kana: string
}

function spanCentre(s: ReadingSpan): number {
  return (s.start + s.end + 1) / 2
}
function spanHalf(s: ReadingSpan): number {
  return (s.kana.length * RT_EM) / 2
}

// A reading is centred over its kanji span and may overhang it. Two readings
// collide when the earlier one's right edge (plus a small gap) passes the next
// one's left edge.
export function readingsCollide(a: ReadingSpan, b: ReadingSpan): boolean {
  return spanCentre(a) + spanHalf(a) + READING_GAP_EM > spanCentre(b) - spanHalf(b)
}

export interface ReadingGroup {
  start: number // unit-local char index of the group's first kanji
  end: number // unit-local char index of the group's last kanji (inclusive)
  kana: string // combined reading, centred over the whole group
}

// Fuse adjacent overhanging reading spans into one centred group-ruby span
// (transitive). Shared by groupReadings and the boundary collision test so
// detection measures the same fused width the renderer draws.
function groupSpans(spans: ReadingSpan[]): ReadingSpan[] {
  const groups: ReadingSpan[] = []
  for (const s of spans) {
    const prev = groups[groups.length - 1]
    if (prev && readingsCollide(prev, s)) {
      prev.end = s.end
      prev.kana += s.kana
    } else {
      groups.push({ start: s.start, end: s.end, kana: s.kana })
    }
  }
  return groups
}

// Group a unit's per-kanji readings: any run whose readings would overhang into
// each other is merged so the combined reading centres over the whole kanji
// group (group-ruby) instead of overlapping. Merging is transitive — a widened
// group is re-tested against the next reading. Coordinates are unit-local.
export function groupReadings(
  perKanji: NonNullable<RenderUnit['perKanji']>,
  unitStart: number,
): ReadingGroup[] {
  return groupSpans(
    perKanji.map((pk) => ({
      start: pk.charStart - unitStart,
      end: pk.charEnd - unitStart,
      kana: pk.kana,
    })),
  )
}

// Fields the collision gate reads: a char range plus its reading(s). Both
// RenderUnit and RubyLineSegment satisfy this shape, so the unit- and
// segment-level merges share readingSpans/synthPerKanji/boundaryReadingsCollide
// rather than duplicating the geometry.
interface ReadingBearing {
  charStart: number
  charEnd: number
  kana?: string
  perKanji?: Array<{ charStart: number; charEnd: number; kana: string }>
}

// The reading spans of a unit/segment in LINE-char coords. A per-kanji entry
// contributes one span per perKanji item; a jukujikun (kana, no perKanji)
// contributes one span over its whole kanji range; a bare one contributes none.
function readingSpans(u: ReadingBearing): ReadingSpan[] {
  if (u.kana === undefined) return []
  if (u.perKanji && u.perKanji.length > 0) {
    return u.perKanji.map((pk) => ({
      start: pk.charStart,
      end: pk.charEnd,
      kana: pk.kana,
    }))
  }
  return [{ start: u.charStart, end: u.charEnd, kana: u.kana }]
}

function synthPerKanji(
  u: ReadingBearing,
): NonNullable<RubyLineSegment['perKanji']> {
  if (u.perKanji && u.perKanji.length > 0) return u.perKanji
  return [{ charStart: u.charStart, charEnd: u.charEnd, kana: u.kana ?? '' }]
}

// Two kanji-bearing runs can merge when they are contiguous in line-char space
// and the earlier run's last reading would overhang into the later run's first
// reading. Bare runs (no kana) never merge. Shared by both merge passes.
function boundaryReadingsCollide(a: ReadingBearing, b: ReadingBearing): boolean {
  if (a.kana === undefined || b.kana === undefined) return false
  if (a.charEnd + 1 !== b.charStart) return false
  const aSpans = groupSpans(readingSpans(a))
  const bSpans = groupSpans(readingSpans(b))
  if (aSpans.length === 0 || bSpans.length === 0) return false
  return readingsCollide(aSpans[aSpans.length - 1], bSpans[0])
}

function mergeTwo(a: RenderUnit, b: RenderUnit): RenderUnit {
  // coveringCueIdx: concat b's cues onto a's; a shared boundary cue sums its
  // char count so the wipe layout stays correct.
  const coveringCueIdx = [...a.coveringCueIdx]
  const cueCharCounts = [...a.cueCharCounts]
  for (let i = 0; i < b.coveringCueIdx.length; i++) {
    const cue = b.coveringCueIdx[i]
    const at = coveringCueIdx.indexOf(cue)
    if (at >= 0) cueCharCounts[at] += b.cueCharCounts[i]
    else {
      coveringCueIdx.push(cue)
      cueCharCounts.push(b.cueCharCounts[i])
    }
  }
  return {
    charStart: a.charStart,
    charEnd: b.charEnd,
    kanjiText: a.kanjiText + b.kanjiText,
    kana: (a.kana ?? '') + (b.kana ?? ''),
    nonSplittable: false,
    coveringCueIdx,
    cueCharCounts,
    perKanji: [...synthPerKanji(a), ...synthPerKanji(b)],
  }
}

// Merge adjacent kanji-bearing render units whose boundary readings would
// overhang into each other into ONE unit, so a later group-ruby pass can centre
// the combined reading over the whole kanji group instead of letting the two
// readings overlap. The merged unit spans every covering cue it absorbed, which
// the wipe machinery already handles (one shared front); kanji never move.
// Needed because the tokenizer can split one visual word across cues (e.g.
// 心構えても → 心 + 構え + て + も), which groupReadings alone can't see.
export function mergeCollidingUnits(units: RenderUnit[]): RenderUnit[] {
  const out: RenderUnit[] = []
  for (const cur of units) {
    const prev = out[out.length - 1]
    if (prev && boundaryReadingsCollide(prev, cur)) {
      out[out.length - 1] = mergeTwo(prev, cur)
    } else {
      out.push(cur)
    }
  }
  return out
}

// Segment-level analogue of mergeTwo: segments carry no cue bookkeeping or
// kanjiText, so only the union range, concatenated reading, and per-kanji spans
// remain (a jukujikun contributes one synthesized whole-span entry).
function mergeTwoSegments(
  a: RubyLineSegment,
  b: RubyLineSegment,
): RubyLineSegment {
  return {
    charStart: a.charStart,
    charEnd: b.charEnd,
    kana: (a.kana ?? '') + (b.kana ?? ''),
    nonSplittable: false,
    perKanji: [...synthPerKanji(a), ...synthPerKanji(b)],
  }
}

// Line-model analogue of mergeCollidingUnits: fuse adjacent segments whose
// boundary readings would overhang so a later groupReadings pass centres the
// combined reading over the whole kanji group (group-ruby) instead of letting
// two separately-tokenized words overlap. Callers pass segments pre-sorted by
// charStart; overlapping (non-contiguous) segments never merge and pass through.
export function mergeCollidingSegments(
  segments: RubyLineSegment[],
): RubyLineSegment[] {
  const out: RubyLineSegment[] = []
  for (const cur of segments) {
    const prev = out[out.length - 1]
    if (prev && boundaryReadingsCollide(prev, cur)) {
      out[out.length - 1] = mergeTwoSegments(prev, cur)
    } else {
      out.push(cur)
    }
  }
  return out
}
