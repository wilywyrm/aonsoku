import type {
  RenderUnit,
  RubyLineModel,
  RubyLineSegment,
} from '@/types/furigana'
import type { ReadingGroup } from './grouping'
import type { RubySegmentLayout, RubyUnitLayout } from './layout'

// Spread layout for Latin-script ruby (pinyin). A romanized reading runs far
// wider than its hanzi, so instead of letting it overhang and then shifting,
// condensing or merging it (layout.ts), each unit widens to fit its reading
// (.ruby-spread-sizer in index.css). Readings stay centred at natural width
// over their own characters, so nothing here resolves collisions.

// True when one of the tag's subtags is the Latn script (zh-Latn,
// zh-latn-pinyin), in any case.
export function isLatinScriptSystem(lang: string | undefined): boolean {
  return (lang ?? '').toLowerCase().split(/[-_]/).includes('latn')
}

// Flag every model spread when the ruby system is Latin-script. Any other
// system gets the input map back untouched (same reference).
export function markSpread(
  models: Map<number, RubyLineModel>,
  system: string | undefined,
): Map<number, RubyLineModel> {
  if (!isLatinScriptSystem(system)) return models
  const marked = new Map<number, RubyLineModel>()
  for (const [lineIdx, model] of models) {
    marked.set(lineIdx, { ...model, spread: true })
  }
  return marked
}

// Word path, for one cueLine's reconciled units, in unit-local coords like
// resolveUnitLayout. No merging, and no absorbOkurigana: folding a same-cue
// bare char into a ruby unit (壮，) would centre the widened unit under both
// chars while the reading stays over the hanzi alone, overhanging the edge.
export function resolveSpreadUnitLayout(units: RenderUnit[]): RubyUnitLayout {
  return {
    units: units.map((u) => ({ ...u, spread: true })),
    groups: units.map(spreadUnitGroups),
  }
}

function spreadUnitGroups(u: RenderUnit): ReadingGroup[] {
  if (u.kana === undefined) return []
  if (u.perKanji && u.perKanji.length > 0) {
    return u.perKanji.map((pk) => ({
      start: pk.charStart - u.charStart,
      end: pk.charEnd - u.charStart,
      kana: pk.kana,
    }))
  }
  return [{ start: 0, end: u.charEnd - u.charStart, kana: u.kana }]
}

// Line path, for a line model's segments, in absolute line-char coords like
// resolveSegmentLayout. Overlapping and empty segments are dropped (keep
// first) with resolveSegmentLayout's exact rule, copied because layout.ts
// keeps it private. No merging.
export function resolveSpreadSegmentLayout(
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
  return { segments: kept, groups: kept.map(spreadSegmentGroups) }
}

// perKanji is sorted like resolveSegmentGroups does: buildCells tiles groups
// left to right and drops any that run backwards.
function spreadSegmentGroups(s: RubyLineSegment): ReadingGroup[] {
  if (s.kana === undefined) return []
  if (s.perKanji && s.perKanji.length > 0) {
    return [...s.perKanji]
      .sort((a, b) => a.charStart - b.charStart)
      .map((pk) => ({ start: pk.charStart, end: pk.charEnd, kana: pk.kana }))
  }
  return [{ start: s.charStart, end: s.charEnd, kana: s.kana }]
}
