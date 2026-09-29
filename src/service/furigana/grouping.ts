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
export const READING_TRACK_FLOOR = -0.15

// Float tolerance for edge-to-edge readings (mirrors collidesAtFloor's strict >).
const EPS = 1e-9

// Collision tolerance (base-em) for boundaryCollides. Tracking is rounded to
// 1e-4 rt-em (see dropToTracking), so a boundary that condensation cleared
// exactly can keep a residual of up to 1.25e-5·(k₁+k₂−2) base-em (k = each
// reading's kana count). 1e-3 is therefore safe up to ~80 combined kana gaps,
// and is ≈0.03px at a 32px font.
const BOUNDARY_EPS = 1e-3

// Approximate horizontal advance (base-em) of a NARROW space, used to measure
// the real gap between two space-separated phrases (full-width chars are 1em)
// for jidori and condensing. Font-dependent, so hardcoded just under the
// bundled Poppins space (0.212em bold to 0.267em regular; 0.238em at the
// lyrics' semibold): readings are resolved to exactly touching (READING_GAP_EM
// = 0), so overestimating the gap shows up as overlap, while underestimating
// only leaves a hair of extra room. Base kanji never move.
export const SPACE_ADVANCE_EM = 0.2

// Aesthetic cap (base-em) on how far jidori may shift a reading off the centre of
// its own kanji before it looks detached. Tuned by eye like the other constants.
export const JIDORI_MAX_SHIFT = 0.5

// One reading over a contiguous kanji span. start/end are inclusive char indices
// in whatever coordinate space the caller uses (unit-local for within-unit reading
// resolution via resolveReadingGroups/collidesAtFloor); collidesAtFloor only
// compares relative positions, so any consistent origin works. 1 em == 1 base char.
export interface ReadingSpan {
  start: number
  end: number
  kana: string
}

function spanCentre(s: ReadingSpan): number {
  return (s.start + s.end + 1) / 2
}

export interface ReadingGroup {
  start: number // unit-local char index of the group's first kanji
  end: number // unit-local char index of the group's last kanji (inclusive)
  kana: string // combined reading, centred over the whole group
  tracking?: number // per-gap letter-spacing (rt-em, < 0) condensing this reading to clear a collision; absent = natural width (overhang kept)
  shift?: number // horizontal offset (base-em, + = right) shifting this reading off-centre into adjacent reading-less space (jidori); absent = centred
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
// centre distance and is counted.
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
// are unit-local.
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

function shiftOf(g: ReadingGroup): number {
  return g.shift ?? 0
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

// A kana-bearing unit/segment as the cross-item passes see it: its render groups
// plus `baseOffset`, which maps a group's start/end into the line text
// (unit.charStart for the word path, 0 for the line path).
export interface ReadingItem {
  groups: ReadingGroup[]
  baseOffset: number
}

// Condense the BOUNDARY readings of adjacent kana-bearing items (in order) so a
// reading in one item doesn't overlap the next item's — across the (narrow)
// space between two phrases, or where their kanji touch — WITHOUT merging (a
// group-ruby must never span a space; merging contiguous items is left to the
// caller). Mutates group.tracking in place. The gap is measured from each
// boundary group's base edge (so okurigana between the reading and the space is
// counted) with advance-aware widths, and is 0 when the kanji touch; the
// overlap is shed symmetrically, capped at the floor, and any residual (gap too
// narrow to fully clear) is accepted.
export function condenseAcrossGaps(items: ReadingItem[], text: string): void {
  for (let i = 1; i < items.length; i++) {
    const left = items[i - 1]
    const right = items[i]
    const lg = left.groups[left.groups.length - 1]
    const rg = right.groups[0]
    if (!lg || !rg) continue
    const absLeftEnd = left.baseOffset + lg.end
    const absRightStart = right.baseOffset + rg.start
    if (absRightStart <= absLeftEnd) continue
    const overlap =
      groupOverhang(lg) +
      groupOverhang(rg) -
      gapAdvanceEm(text, absLeftEnd + 1, absRightStart) +
      shiftOf(lg) -
      shiftOf(rg)
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

// Cumulative advance (base-em) of text[0, i): a reading over base chars
// [start, end] spans [prefix[start], prefix[end + 1]]. Narrow whitespace counts
// as SPACE_ADVANCE_EM — this is what makes jidori aware of the real gap widths.
function advancePrefix(text: string): number[] {
  const prefix = new Array<number>(text.length + 1)
  prefix[0] = 0
  for (let i = 0; i < text.length; i++) {
    prefix[i + 1] = prefix[i] + charAdvanceEm(text[i])
  }
  return prefix
}

// One reading placed on the advance-em axis: `centre` is its fixed home centre
// over its kanji; its live edges add the current `shift`.
interface ShiftNode {
  group: ReadingGroup
  centre: number
  half: number
}

function leftEdge(n: ShiftNode): number {
  return n.centre + shiftOf(n.group) - n.half
}

function rightEdge(n: ShiftNode): number {
  return n.centre + shiftOf(n.group) + n.half
}

// How far node i's reading can travel left: its own remaining budget vs. the
// slack to its left neighbour PLUS however far that neighbour can itself yield
// left (recruit). Bounded by JIDORI_MAX_SHIFT and the line start.
function roomLeft(nodes: ShiftNode[], i: number): number {
  const own = JIDORI_MAX_SHIFT + shiftOf(nodes[i].group)
  const slack =
    i === 0 ? leftEdge(nodes[0]) : leftEdge(nodes[i]) - rightEdge(nodes[i - 1])
  const recruit = i === 0 ? 0 : roomLeft(nodes, i - 1)
  return Math.max(0, Math.min(own, slack + recruit))
}

function roomRight(nodes: ShiftNode[], i: number, lineEnd: number): number {
  const last = nodes.length - 1
  const own = JIDORI_MAX_SHIFT - shiftOf(nodes[i].group)
  const slack =
    i === last
      ? lineEnd - rightEdge(nodes[i])
      : leftEdge(nodes[i + 1]) - rightEdge(nodes[i])
  const recruit = i === last ? 0 : roomRight(nodes, i + 1, lineEnd)
  return Math.max(0, Math.min(own, slack + recruit))
}

// Move node i left by d, pushing any reading it runs into further left (cascade).
// Callers pass d <= roomLeft(i), so the cascade never exceeds a reading's budget.
function pushLeft(nodes: ShiftNode[], i: number, d: number): void {
  nodes[i].group.shift = shiftOf(nodes[i].group) - d
  if (i > 0) {
    const over = rightEdge(nodes[i - 1]) - leftEdge(nodes[i])
    if (over > EPS) pushLeft(nodes, i - 1, over)
  }
}

function pushRight(nodes: ShiftNode[], i: number, d: number): void {
  nodes[i].group.shift = shiftOf(nodes[i].group) + d
  if (i < nodes.length - 1) {
    const over = rightEdge(nodes[i]) - leftEdge(nodes[i + 1])
    if (over > EPS) pushRight(nodes, i + 1, over)
  }
}

// Jidori: resolve overhang collisions between adjacent readings by shifting the
// members of a colliding pair apart into adjacent reading-less room — cascading
// through blocking readings (a wide reading pushes its neighbour aside rather
// than shrinking it or touching the space). The shift is symmetric (each side
// moves half the overlap) when both sides have room for half; when one side is
// short (a blocking neighbour, the line edge, JIDORI_MAX_SHIFT), the other side
// takes the remainder, up to its own room. Runs BEFORE condenseAcrossGaps:
// whatever overlap the room can't clear falls through to condensation. Mutates
// group.shift in place; purely visual (never touches char counts, cue coverage,
// or the wipe). `items` are the kana-bearing units/segments in order. A reading
// wedged between two collisions is best-effort.
export function shiftAcrossGaps(items: ReadingItem[], text: string): void {
  const prefix = advancePrefix(text)
  const lineEnd = prefix[text.length]
  const nodes: ShiftNode[] = []
  for (const item of items) {
    for (const g of item.groups) {
      const l = prefix[item.baseOffset + g.start]
      const r = prefix[item.baseOffset + g.end + 1]
      nodes.push({
        group: g,
        centre: (l + r) / 2,
        half: (g.kana.length * RT_EM - currentDrop(g)) / 2,
      })
    }
  }
  nodes.sort((a, b) => a.centre - b.centre)
  for (let i = 1; i < nodes.length; i++) {
    const overlap = rightEdge(nodes[i - 1]) - leftEdge(nodes[i])
    if (overlap <= EPS) continue
    const half = overlap / 2
    const rl = roomLeft(nodes, i - 1)
    const rr = roomRight(nodes, i, lineEnd)
    let dl = Math.min(half, rl)
    let dr = Math.min(half, rr)
    if (dl < half) dr = Math.min(rr, overlap - dl)
    if (dr < half) dl = Math.min(rl, overlap - dr)
    if (dl > EPS) pushLeft(nodes, i - 1, dl)
    if (dr > EPS) pushRight(nodes, i, dr)
  }
}

// Whether the last reading of `left` still overlaps the first reading of
// `right` as rendered: at their current tracking and shift, placed exactly as
// shiftAcrossGaps places them (advance-em centre over the kanji, half-width net
// of tracking), so the two never disagree. An overlap within BOUNDARY_EPS is
// tracking-rounding noise, not a collision. Pure geometry: whether a colliding
// pair may merge (contiguity, spaces, okurigana) is the caller's decision.
export function boundaryCollides(
  left: ReadingItem,
  right: ReadingItem,
  text: string,
): boolean {
  const lg = left.groups[left.groups.length - 1]
  const rg = right.groups[0]
  if (!lg || !rg) return false
  const prefix = advancePrefix(text)
  const centre = (g: ReadingGroup, base: number) =>
    (prefix[base + g.start] + prefix[base + g.end + 1]) / 2
  const half = (g: ReadingGroup) => (g.kana.length * RT_EM - currentDrop(g)) / 2
  return (
    centre(lg, left.baseOffset) +
      shiftOf(lg) +
      half(lg) +
      READING_GAP_EM -
      (centre(rg, right.baseOffset) + shiftOf(rg) - half(rg)) >
    BOUNDARY_EPS
  )
}

// A char-range-plus-reading shape that both RenderUnit and RubyLineSegment
// satisfy, used by synthPerKanji when mergeUnitPair, mergeSegmentPair, and
// absorbOkurigana fold or merge units/segments together. The shift-first loop
// in layout.ts calls these merge primitives, which internally use synthPerKanji
// to unify the two types' geometry.
interface ReadingBearing {
  charStart: number
  charEnd: number
  kana?: string
  perKanji?: Array<{ charStart: number; charEnd: number; kana: string }>
}

function synthPerKanji(
  u: ReadingBearing,
): NonNullable<RubyLineSegment['perKanji']> {
  if (u.perKanji && u.perKanji.length > 0) return u.perKanji
  return [{ charStart: u.charStart, charEnd: u.charEnd, kana: u.kana ?? '' }]
}

// Merge two adjacent render units into one, combining their cue coverage and
// per-kanji spans. Used as a primitive by the shift-first loop in layout.ts
// when two units' boundary readings collide.
export function mergeUnitPair(a: RenderUnit, b: RenderUnit): RenderUnit {
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

// Merge two adjacent line-model segments into one, combining their reading and
// per-kanji spans. Used as a primitive by the shift-first loop in layout.ts
// when two segments' boundary readings collide.
export function mergeSegmentPair(
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
