import type { RenderUnit, RubyLineSegment } from '@/types/furigana'
import {
  absorbOkurigana,
  boundaryCollides,
  condenseAcrossGaps,
  mergeSegmentPair,
  mergeUnitPair,
  type ReadingGroup,
  type ReadingItem,
  resolveSegmentGroups,
  resolveUnitGroups,
  shiftAcrossGaps,
} from './grouping'

// Ruby collision resolution shared by the word-level and line-level lyrics
// views, so the two can't drift apart. Callers render the returned items and
// groups as-is instead of re-resolving them.

// groups[i] belongs to units[i], in unit-local coords (what RubyCueContent
// draws).
export interface RubyUnitLayout {
  units: RenderUnit[]
  groups: ReadingGroup[][]
}

// groups[i] belongs to segments[i], in absolute line-char coords (what
// buildLineRenderSpans tiles).
export interface RubySegmentLayout {
  segments: RubyLineSegment[]
  groups: ReadingGroup[][]
}

// Resolve every item's groups, then jidori-shift and condense readings across
// item boundaries over the whole line. Groups are rebuilt on every call because
// shift/condense mutate them in place: reused objects would stack a previous
// pass's shift and tracking. Reading-less items keep an empty slot, so groups
// stay parallel to items, but sit out the cross-item pass.
function layoutPass<T>(
  items: T[],
  text: string,
  groupsOf: (item: T) => ReadingGroup[],
  baseOffsetOf: (item: T) => number,
): ReadingGroup[][] {
  const groups = items.map(groupsOf)
  const readingItems: ReadingItem[] = []
  for (let i = 0; i < items.length; i++) {
    if (groups[i].length === 0) continue
    readingItems.push({ groups: groups[i], baseOffset: baseOffsetOf(items[i]) })
  }
  shiftAcrossGaps(readingItems, text)
  condenseAcrossGaps(readingItems, text)
  return groups
}

// Shift-first: each pass lays the line out from scratch (resolve, jidori-shift,
// condense), then merges only the leftmost contiguous kana-bearing pair whose
// readings still collide, and the next pass rescans from the line start. So a
// merge only mops up what shifting and condensing couldn't clear, never
// pre-empts them. Each merge removes one item, so a call merges at most
// items.length - 1 times. resolveUnitLayout's pass after absorbOkurigana runs
// no merge check: folding okurigana into its ruby unit moves no reading, so
// that pass redraws this loop's last geometry, and a check there could only
// catch pairs the fold made contiguous across okurigana.
function resolveLayout<
  T extends { charStart: number; charEnd: number; kana?: string },
>(
  items: T[],
  text: string,
  groupsOf: (item: T) => ReadingGroup[],
  baseOffsetOf: (item: T) => number,
  merge: (a: T, b: T) => T,
): { items: T[]; groups: ReadingGroup[][] } {
  let cur = items
  while (true) {
    const groups = layoutPass(cur, text, groupsOf, baseOffsetOf)
    const i = cur.findIndex((left, k) => {
      if (k + 1 === cur.length) return false
      const right = cur[k + 1]
      return (
        left.kana !== undefined &&
        right.kana !== undefined &&
        groups[k].length > 0 &&
        groups[k + 1].length > 0 &&
        left.charEnd + 1 === right.charStart &&
        boundaryCollides(
          { groups: groups[k], baseOffset: baseOffsetOf(left) },
          { groups: groups[k + 1], baseOffset: baseOffsetOf(right) },
          text,
        )
      )
    })
    if (i < 0) return { items: cur, groups }
    cur = [...cur.slice(0, i), merge(cur[i], cur[i + 1]), ...cur.slice(i + 2)]
  }
}

// Word path, for one cueLine's reconciled units. Merging runs before
// absorbOkurigana, while bare okurigana is still its own unit, so readings never
// merge across it. Unit groups are unit-local, hence baseOffset = charStart.
export function resolveUnitLayout(
  units: RenderUnit[],
  text: string,
): RubyUnitLayout {
  const { items } = resolveLayout(
    units,
    text,
    resolveUnitGroups,
    (u) => u.charStart,
    mergeUnitPair,
  )
  const final = absorbOkurigana(items)
  return {
    units: final,
    groups: layoutPass(final, text, resolveUnitGroups, (u) => u.charStart),
  }
}

// Line path, for a line model's segments. Overlapping and empty segments are
// dropped (keep first) with buildLineRenderSpans' exact clamp rule BEFORE
// layout: they never render, so they must not merge with, shift or condense
// the segments that do. Segment groups are absolute, hence baseOffset 0.
export function resolveSegmentLayout(
  segments: RubyLineSegment[],
  text: string,
): RubySegmentLayout {
  const sorted = [...segments].sort((a, b) => a.charStart - b.charStart)
  const kept: RubyLineSegment[] = []
  let cursor = 0
  for (const s of sorted) {
    const start = Math.max(0, s.charStart)
    // charEnd is inclusive; compare exclusive ends like the tiler does.
    const end = Math.min(text.length, s.charEnd + 1)
    if (end <= start || start < cursor) continue
    kept.push(s)
    cursor = end
  }
  const result = resolveLayout(
    kept,
    text,
    resolveSegmentGroups,
    () => 0,
    mergeSegmentPair,
  )
  return { segments: result.items, groups: result.groups }
}
