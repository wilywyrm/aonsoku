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

// Most-negative letter-spacing (in rt-em, i.e. multiples of the .ruby-furi-rt
// font-size) applied BETWEEN kana of a colliding reading before its glyphs start
// to touch. On a collision a reading is condensed at most this far; only if that
// still doesn't clear the overlap are the readings merged (group-ruby) instead —
// "condense first, merge as a last resort". Tuned by eye (visual QA): more
// negative resolves more collisions without merging but packs kana tighter.
export const READING_TRACK_FLOOR = -0.2

// Float tolerance for edge-to-edge readings (mirrors readingsCollide's strict >).
const EPS = 1e-9

// Approximate horizontal advance (base-em) of a NARROW space — used only to
// measure the real gap between two space-separated compound phrases (full-width
// chars are 1em). Hardcoded because it is font-dependent and only tunes how
// aggressively cross-gap readings condense: being off yields a hair more/less
// residual overlap, never layout breakage (base kanji never move).
export const SPACE_ADVANCE_EM = 0.33

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
  return (
    spanCentre(a) + spanHalf(a) + READING_GAP_EM > spanCentre(b) - spanHalf(b)
  )
}

export interface ReadingGroup {
  start: number // unit-local char index of the group's first kanji
  end: number // unit-local char index of the group's last kanji (inclusive)
  kana: string // combined reading, centred over the whole group
  tracking?: number // per-gap letter-spacing (rt-em, < 0) condensing this reading to clear a collision; absent = natural width (overhang kept)
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

// A reading being resolved for render: its char span, current combined kana, and
// how much width (base-em) it has already shed via negative tracking. `drop`
// grows as the reading is condensed to clear a collision on either side.
interface WorkingGroup {
  start: number
  end: number
  kana: string
  drop: number
}

// Effective half-width (base-em) after shedding `drop`. Natural width is
// kana.length * RT_EM; symmetric tracking removes `drop` centred, so each edge
// moves inward by drop / 2.
function effHalf(g: WorkingGroup): number {
  return (g.kana.length * RT_EM - g.drop) / 2
}

// Widest a reading of `kanaLen` kana can shed (base-em) by tracking its gaps down
// to READING_TRACK_FLOOR: (kanaLen - 1) gaps, each worth RT_EM base-em per 1
// rt-em of letter-spacing. Single-kana readings have no gaps -> 0.
function trackingBudget(kanaLen: number): number {
  if (kanaLen <= 1) return 0
  return (kanaLen - 1) * -READING_TRACK_FLOOR * RT_EM
}

// Inverse of trackingBudget: per-gap letter-spacing (rt-em, <= 0) that sheds
// `dropBaseEm` of width, clamped to the floor and rounded to a clean CSS value.
function dropToTracking(kanaLen: number, dropBaseEm: number): number {
  if (kanaLen <= 1 || dropBaseEm <= EPS) return 0
  const t = -dropBaseEm / ((kanaLen - 1) * RT_EM)
  return Math.round(Math.max(t, READING_TRACK_FLOOR) * 1e4) / 1e4
}

// Half-width (base-em) of a reading fully condensed to READING_TRACK_FLOOR — the
// tightest it can render without merging.
function floorHalf(s: ReadingSpan): number {
  return (s.kana.length * RT_EM - trackingBudget(s.kana.length)) / 2
}

// Two readings that overlap even when BOTH are condensed to the floor: no amount
// of tracking can separate them, so they must merge.
function collidesAtFloor(a: ReadingSpan, b: ReadingSpan): boolean {
  return (
    spanCentre(a) + floorHalf(a) + READING_GAP_EM > spanCentre(b) - floorHalf(b)
  )
}

// Split `need` (total base-em width two adjacent readings must shed to clear an
// overlap) across their remaining budgets, proportional to headroom and clamped
// to each. When the combined budget can't cover `need`, shed everything available
// and leave the rest — the caller decides whether the residual is accepted
// (cross-gap) or was already ruled out by a prior merge (within-unit).
function distributeShed(
  prevAvail: number,
  curAvail: number,
  need: number,
): { dPrev: number; dCur: number } {
  const total = Math.min(need, prevAvail + curAvail)
  if (total <= EPS) return { dPrev: 0, dCur: 0 }
  let dCur = total * (curAvail / (prevAvail + curAvail))
  let dPrev = total - dCur
  if (dPrev > prevAvail) {
    dPrev = prevAvail
    dCur = total - dPrev
  }
  if (dCur > curAvail) {
    dCur = curAvail
    dPrev = total - dCur
  }
  return { dPrev, dCur }
}

// Resolve a unit's per-kanji readings into render groups, preferring condensation
// over merging.
//   Phase 1 (merge — last resort): fuse only runs that would still overlap when
//   fully condensed to the floor. The monotonic stack re-tests leftward, so a
//   widened merge cascades into the previous group when it now collides too.
//   Phase 2 (condense): readings that overlap at natural width but clear at the
//   floor are tracked apart and kept as separate mono-ruby cells. Feasible by
//   construction — after phase 1 no adjacent groups collide at the floor, so a
//   colliding pair's remaining budget always covers the 2 * overlap it must shed
//   (symmetric tracking moves each edge in by half that reading's width drop).
// Coordinates are unit-local, so an internal gap (space / okurigana) widens the
// centre distance and is counted. (groupSpans stays the pure-merge model the
// unit/segment boundary collision test measures with.)
function resolveReadingGroups(spans: ReadingSpan[]): ReadingGroup[] {
  const merged: ReadingSpan[] = []
  for (const s of spans) {
    let cur: ReadingSpan = { start: s.start, end: s.end, kana: s.kana }
    while (
      merged.length > 0 &&
      collidesAtFloor(merged[merged.length - 1], cur)
    ) {
      const top = merged.pop()!
      cur = { start: top.start, end: cur.end, kana: top.kana + cur.kana }
    }
    merged.push(cur)
  }

  const work: WorkingGroup[] = merged.map((g) => ({
    start: g.start,
    end: g.end,
    kana: g.kana,
    drop: 0,
  }))
  for (let i = 1; i < work.length; i++) {
    const prev = work[i - 1]
    const cur = work[i]
    const overlap =
      spanCentre(prev) +
      effHalf(prev) +
      READING_GAP_EM -
      (spanCentre(cur) - effHalf(cur))
    if (overlap <= EPS) continue
    const prevAvail = Math.max(0, trackingBudget(prev.kana.length) - prev.drop)
    const curAvail = Math.max(0, trackingBudget(cur.kana.length) - cur.drop)
    const { dPrev, dCur } = distributeShed(prevAvail, curAvail, 2 * overlap)
    prev.drop += dPrev
    cur.drop += dCur
  }

  return work.map((g) => {
    const tracking = dropToTracking(g.kana.length, g.drop)
    return tracking < 0
      ? { start: g.start, end: g.end, kana: g.kana, tracking }
      : { start: g.start, end: g.end, kana: g.kana }
  })
}

// Group a unit's per-kanji readings for rendering: adjacent readings that would
// overhang into each other are condensed within READING_TRACK_FLOOR to clear the
// overlap (kept as separate mono-ruby cells, each carrying its `tracking`); only
// when condensing cannot fit do they merge into one group-ruby span. Coordinates
// are unit-local. (groupSpans stays the pure-merge model the unit/segment
// boundary collision test measures with.)
export function groupReadings(
  perKanji: NonNullable<RenderUnit['perKanji']>,
  unitStart: number,
): ReadingGroup[] {
  return resolveReadingGroups(
    perKanji.map((pk) => ({
      start: pk.charStart - unitStart,
      end: pk.charEnd - unitStart,
      kana: pk.kana,
    })),
  )
}

// Base-em width a group has already shed via its current tracking (inverse of
// dropToTracking): tracking is per-gap letter-spacing (rt-em) over (len-1) gaps.
function currentDrop(g: ReadingGroup): number {
  return g.tracking ? -g.tracking * (g.kana.length - 1) * RT_EM : 0
}

// How far a group's reading extends past its base span edge on EACH side
// (positive = overhang), at its current (possibly already-condensed) width.
function groupOverhang(g: ReadingGroup): number {
  return (
    (g.kana.length * RT_EM - currentDrop(g)) / 2 - (g.end - g.start + 1) / 2
  )
}

// Approximate advance (base-em) of one character when measuring a phrase gap:
// narrow ASCII whitespace is SPACE_ADVANCE_EM; everything else — CJK, kana, the
// ideographic space U+3000, and (deliberately) Latin — is 1em. Over-counting
// Latin only ever UNDER-condenses (safe); real inter-phrase gaps are whitespace.
function charAdvanceEm(ch: string): number {
  return /\s/.test(ch) && ch !== '\u3000' ? SPACE_ADVANCE_EM : 1
}

function gapAdvanceEm(text: string, from: number, to: number): number {
  let w = 0
  for (let i = from; i < to; i++) w += charAdvanceEm(text[i])
  return w
}

// Render groups for one unit in UNIT-LOCAL coords (what renderFuriCells draws): a
// jukujikun (kana, no perKanji) is a single whole-span group so it too can carry
// tracking; a splittable unit condenses/merges its per-kanji readings; a bare
// unit has none.
export function resolveUnitGroups(unit: RenderUnit): ReadingGroup[] {
  if (unit.kana === undefined) return []
  if (!unit.perKanji || unit.perKanji.length === 0) {
    return [{ start: 0, end: unit.kanjiText.length - 1, kana: unit.kana }]
  }
  return groupReadings(unit.perKanji, unit.charStart)
}

// Render groups for one line-model segment in ABSOLUTE line-char coords.
export function resolveSegmentGroups(seg: RubyLineSegment): ReadingGroup[] {
  if (seg.kana === undefined) return []
  if (seg.nonSplittable || !seg.perKanji || seg.perKanji.length === 0) {
    return [{ start: seg.charStart, end: seg.charEnd, kana: seg.kana }]
  }
  return groupReadings(
    [...seg.perKanji].sort((a, b) => a.charStart - b.charStart),
    0,
  )
}

// Condense the BOUNDARY readings of adjacent kana-bearing items so a reading in
// one phrase doesn't overlap the next phrase's across the (narrow) space between
// them — WITHOUT merging (a group-ruby must never span a space). Mutates
// group.tracking in place. `items` are the kana-bearing units/segments in order;
// `baseOffset` maps a group's start/end into `text` (unit.charStart for the word
// path, 0 for the line path). The gap is measured from each boundary group's base
// edge (so okurigana between the reading and the space is counted) with
// advance-aware widths; the overlap is shed symmetrically, capped at the floor,
// and any residual (space too narrow to fully clear) is accepted.
export function condenseAcrossGaps(
  items: Array<{ groups: ReadingGroup[]; baseOffset: number }>,
  text: string,
): void {
  for (let i = 1; i < items.length; i++) {
    const left = items[i - 1]
    const right = items[i]
    const lg = left.groups[left.groups.length - 1]
    const rg = right.groups[0]
    if (!lg || !rg) continue
    const absLeftEnd = left.baseOffset + lg.end
    const absRightStart = right.baseOffset + rg.start
    if (absRightStart <= absLeftEnd + 1) continue
    const overlap =
      groupOverhang(lg) +
      groupOverhang(rg) -
      gapAdvanceEm(text, absLeftEnd + 1, absRightStart)
    if (overlap <= EPS) continue
    const prevAvail = Math.max(
      0,
      trackingBudget(lg.kana.length) - currentDrop(lg),
    )
    const curAvail = Math.max(
      0,
      trackingBudget(rg.kana.length) - currentDrop(rg),
    )
    const { dPrev, dCur } = distributeShed(prevAvail, curAvail, 2 * overlap)
    if (dPrev > EPS) {
      lg.tracking = dropToTracking(lg.kana.length, currentDrop(lg) + dPrev)
    }
    if (dCur > EPS) {
      rg.tracking = dropToTracking(rg.kana.length, currentDrop(rg) + dCur)
    }
  }
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
function boundaryReadingsCollide(
  a: ReadingBearing,
  b: ReadingBearing,
): boolean {
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
// Needed because word segmentation can split one visual word across cues (e.g.
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

// A bare unit carrying real text (okurigana / particle), not whitespace.
function isBareText(u: RenderUnit): boolean {
  return u.kana === undefined && u.kanjiText.trim() !== ''
}

// Both units occupy exactly one, identical cue — so folding them cannot change
// any cue's total char count, leaving the shared wipe front untouched.
function sameSingleCue(a: RenderUnit, b: RenderUnit): boolean {
  return (
    a.coveringCueIdx.length === 1 &&
    b.coveringCueIdx.length === 1 &&
    a.coveringCueIdx[0] === b.coveringCueIdx[0]
  )
}

// A ruby unit directly abutting bare okurigana (either order) inside one cue.
function canAbsorb(prev: RenderUnit, cur: RenderUnit): boolean {
  if (prev.charEnd + 1 !== cur.charStart) return false
  if (!sameSingleCue(prev, cur)) return false
  const prevRuby = prev.kana !== undefined
  const curRuby = cur.kana !== undefined
  return (prevRuby && isBareText(cur)) || (isBareText(prev) && curRuby)
}

// Fold prev+cur (already in char order) into one unit: kanjiText spans both, the
// reading stays over the kanji via the ruby unit's perKanji (synthesized from its
// own span when absent, so the okurigana renders as a trailing/leading gap cell),
// and cueCharCounts collapses to the single shared cue's span.
function foldOkurigana(prev: RenderUnit, cur: RenderUnit): RenderUnit {
  const ruby = prev.kana !== undefined ? prev : cur
  const charStart = prev.charStart
  const charEnd = cur.charEnd
  return {
    charStart,
    charEnd,
    kanjiText: prev.kanjiText + cur.kanjiText,
    kana: ruby.kana,
    nonSplittable: false,
    coveringCueIdx: ruby.coveringCueIdx,
    cueCharCounts: [charEnd - charStart + 1],
    perKanji: synthPerKanji(ruby),
  }
}

// Reconcile emits a ruby kanji unit and its bare okurigana (a trailing っ or
// particle, a leading お) as SEPARATE units within a single cue, so each becomes
// its own hover/wipe <span>. Fold that okurigana back into the ruby unit it abuts
// (same single cue only) so the word highlights and wipes as one span while the
// reading still sits over just the kanji. Multi-cue units (a jukujikun straddling
// cues) are left untouched.
export function absorbOkurigana(units: RenderUnit[]): RenderUnit[] {
  const out: RenderUnit[] = []
  for (const cur of units) {
    const prev = out[out.length - 1]
    if (prev && canAbsorb(prev, cur)) {
      out[out.length - 1] = foldOkurigana(prev, cur)
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
