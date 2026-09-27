import type { RenderUnit, RubyLineSegment } from '@/types/furigana'
import {
  absorbOkurigana,
  condenseAcrossGaps,
  mergeCollidingSegments,
  mergeCollidingUnits,
  type ReadingGroup,
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
  const readingItems: Array<{ groups: ReadingGroup[]; baseOffset: number }> = []
  for (let i = 0; i < items.length; i++) {
    if (groups[i].length === 0) continue
    readingItems.push({ groups: groups[i], baseOffset: baseOffsetOf(items[i]) })
  }
  shiftAcrossGaps(readingItems, text)
  condenseAcrossGaps(readingItems, text)
  return groups
}

// Word path, for one cueLine's reconciled units. Merging runs before
// absorbOkurigana, while bare okurigana is still its own unit, so readings never
// merge across it. Unit groups are unit-local, hence baseOffset = charStart.
export function resolveUnitLayout(
  units: RenderUnit[],
  text: string,
): RubyUnitLayout {
  const merged = absorbOkurigana(mergeCollidingUnits(units))
  return {
    units: merged,
    groups: layoutPass(merged, text, resolveUnitGroups, (u) => u.charStart),
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
  const merged = mergeCollidingSegments(kept)
  return {
    segments: merged,
    groups: layoutPass(merged, text, resolveSegmentGroups, () => 0),
  }
}
