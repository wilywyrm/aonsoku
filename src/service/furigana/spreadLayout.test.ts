import { describe, expect, it } from 'vitest'
import type {
  RenderUnit,
  RubyLineModel,
  RubyLineSegment,
} from '@/types/furigana'
import { resolveSegmentLayout, resolveUnitLayout } from './layout'
import {
  isLatinScriptSystem,
  markSpread,
  resolveSpreadSegmentLayout,
  resolveSpreadUnitLayout,
} from './spreadLayout'

function unit(over: Partial<RenderUnit>): RenderUnit {
  return {
    charStart: 0,
    charEnd: 0,
    kanjiText: '',
    kana: undefined,
    nonSplittable: false,
    coveringCueIdx: [0],
    cueCharCounts: [1],
    ...over,
  }
}

function seg(over: Partial<RubyLineSegment>): RubyLineSegment {
  return {
    charStart: 0,
    charEnd: 0,
    kana: undefined,
    nonSplittable: false,
    ...over,
  }
}

// Punct fixture (main cues 壮， | 丽) as reconcile emits it: the ， shares 壮's
// cue but carries no reading.
const punctText = '壮，丽'
const zhuang = unit({
  charStart: 0,
  charEnd: 0,
  kanjiText: '壮',
  kana: 'zhuàng',
  nonSplittable: true,
  coveringCueIdx: [0],
})
const comma = unit({
  charStart: 1,
  charEnd: 1,
  kanjiText: '，',
  coveringCueIdx: [0],
})
const li = unit({
  charStart: 2,
  charEnd: 2,
  kanjiText: '丽',
  kana: 'lì',
  nonSplittable: true,
  coveringCueIdx: [1],
})

// Long-syllable fixture: readings several times wider than their hanzi.
const longText = '床前明月光'
const chuang = seg({
  charStart: 0,
  charEnd: 0,
  kana: 'chuáng',
  nonSplittable: true,
})
const qian = seg({
  charStart: 1,
  charEnd: 1,
  kana: 'qián',
  nonSplittable: true,
})

describe('isLatinScriptSystem', () => {
  it('is true when any subtag is Latn, in any case or separator', () => {
    expect(isLatinScriptSystem('zh-latn')).toBe(true)
    expect(isLatinScriptSystem('zh-Latn-pinyin')).toBe(true)
    expect(isLatinScriptSystem('zh_Latn')).toBe(true)
  })

  it('is false for other scripts, look-alike subtags and no tag', () => {
    expect(isLatinScriptSystem('ja-Hira')).toBe(false)
    expect(isLatinScriptSystem('zh-Hans')).toBe(false)
    // A whole-subtag match, not a substring search.
    expect(isLatinScriptSystem('zh-Latnx')).toBe(false)
    expect(isLatinScriptSystem('')).toBe(false)
    expect(isLatinScriptSystem(undefined)).toBe(false)
  })
})

describe('markSpread', () => {
  const models = new Map<number, RubyLineModel>([
    [0, { segments: [chuang] }],
    [2, { segments: [qian] }],
  ])

  it('marks every model spread for a Latin-script system, in a new map', () => {
    const marked = markSpread(models, 'zh-Latn')
    expect(marked).not.toBe(models)
    expect([...marked.keys()]).toEqual([0, 2])
    for (const [lineIdx, model] of marked) {
      expect(model.spread).toBe(true)
      expect(model.segments).toBe(models.get(lineIdx)?.segments)
    }
    // Models are copied, never flagged in place.
    for (const model of models.values()) expect(model.spread).toBeUndefined()
  })

  it('returns the input map itself for non-Latin or missing systems', () => {
    expect(markSpread(models, 'ja-Hira')).toBe(models)
    expect(markSpread(models, undefined)).toBe(models)
    for (const model of models.values()) expect(model.spread).toBeUndefined()
  })
})

describe('resolveSpreadUnitLayout', () => {
  it('never absorbs same-cue punctuation into a ruby unit (壮，丽)', () => {
    const units = [zhuang, comma, li]
    // The default path folds ， into 壮's unit. A sizer would then centre the
    // widened unit under 壮， while zhuàng stays over 壮 alone, overhanging.
    expect(resolveUnitLayout(units, punctText).units).toHaveLength(2)

    const layout = resolveSpreadUnitLayout(units)
    expect(layout.units).toHaveLength(3)
    expect(layout.units).toStrictEqual(
      units.map((u) => ({ ...u, spread: true })),
    )
    // toStrictEqual: no tracking/shift keys at all, not even undefined ones.
    expect(layout.groups).toStrictEqual([
      [{ start: 0, end: 0, kana: 'zhuàng' }],
      [],
      [{ start: 0, end: 0, kana: 'lì' }],
    ])
  })

  it('emits one unit-local group per perKanji entry', () => {
    // 明月光 at line chars 4..6 of 我爱你 明月光. The default path would
    // condense or merge these readings; spread keeps both at natural width.
    const mingyueguang = unit({
      charStart: 4,
      charEnd: 6,
      kanjiText: '明月光',
      kana: 'míngyuèguāng',
      perKanji: [
        { charStart: 4, charEnd: 4, kana: 'míng' },
        { charStart: 5, charEnd: 6, kana: 'yuèguāng' },
      ],
    })
    const layout = resolveSpreadUnitLayout([mingyueguang])
    expect(layout.units).toStrictEqual([{ ...mingyueguang, spread: true }])
    // 4-4..4-4 = 0..0 and 5-4..6-4 = 1..2.
    expect(layout.groups).toStrictEqual([
      [
        { start: 0, end: 0, kana: 'míng' },
        { start: 1, end: 2, kana: 'yuèguāng' },
      ],
    ])
  })

  it('gives a reading without perKanji one whole-unit group', () => {
    const jinri = { charStart: 3, charEnd: 4, kanjiText: '今日', kana: 'jīnrì' }
    const layout = resolveSpreadUnitLayout([
      unit({ ...jinri, nonSplittable: true }),
      // An empty perKanji list counts as none, as in resolveUnitGroups.
      unit({ ...jinri, perKanji: [] }),
    ])
    expect(layout.groups).toStrictEqual([
      [{ start: 0, end: 1, kana: 'jīnrì' }],
      [{ start: 0, end: 1, kana: 'jīnrì' }],
    ])
  })
})

describe('resolveSpreadSegmentLayout', () => {
  it('never merges adjacent colliding segments (床前)', () => {
    // Shifting and condensing can't clear chuáng/qián, so the default path
    // merges them into one group-ruby. Spread keeps them apart.
    expect(
      resolveSegmentLayout([chuang, qian], longText).segments,
    ).toHaveLength(1)

    const layout = resolveSpreadSegmentLayout([chuang, qian], longText)
    expect(layout.segments).toHaveLength(2)
    expect(layout.segments[0]).toBe(chuang)
    expect(layout.segments[1]).toBe(qian)
    // Absolute line-char coords, no tracking/shift keys.
    expect(layout.groups).toStrictEqual([
      [{ start: 0, end: 0, kana: 'chuáng' }],
      [{ start: 1, end: 1, kana: 'qián' }],
    ])
  })

  it('drops an overlapping duplicate segment and empty ones (keep-first)', () => {
    const duplicate = seg({ charStart: 0, charEnd: 0, kana: 'chuang' })
    const straddle = seg({ charStart: 0, charEnd: 1, kana: 'chuángqián' })
    const pastEnd = seg({ charStart: 7, charEnd: 8, kana: 'x' })
    const inverted = seg({ charStart: 3, charEnd: 2, kana: 'y' })
    // Fed unsorted: the filter sorts by charStart first, and the sort is
    // stable, so chuang still beats the same-start duplicate and straddle.
    const layout = resolveSpreadSegmentLayout(
      [qian, pastEnd, chuang, duplicate, straddle, inverted],
      longText,
    )
    expect(layout.segments).toEqual([chuang, qian])
    expect(layout.groups).toStrictEqual([
      [{ start: 0, end: 0, kana: 'chuáng' }],
      [{ start: 1, end: 1, kana: 'qián' }],
    ])
  })

  it('emits absolute groups per perKanji entry, in char order', () => {
    const mingyueguang = seg({
      charStart: 2,
      charEnd: 4,
      kana: 'míngyuèguāng',
      // Unsorted on purpose: buildCells tiles groups left to right.
      perKanji: [
        { charStart: 4, charEnd: 4, kana: 'guāng' },
        { charStart: 2, charEnd: 3, kana: 'míngyuè' },
      ],
    })
    const layout = resolveSpreadSegmentLayout([mingyueguang], longText)
    expect(layout.segments).toEqual([mingyueguang])
    expect(layout.groups).toStrictEqual([
      [
        { start: 2, end: 3, kana: 'míngyuè' },
        { start: 4, end: 4, kana: 'guāng' },
      ],
    ])
  })

  it('gives a reading without perKanji one whole-segment group, bare none', () => {
    const jinri = seg({
      charStart: 1,
      charEnd: 2,
      kana: 'jīnrì',
      nonSplittable: true,
    })
    const bare = seg({ charStart: 3, charEnd: 3 })
    const layout = resolveSpreadSegmentLayout([jinri, bare], '我今日好')
    expect(layout.groups).toStrictEqual([
      [{ start: 1, end: 2, kana: 'jīnrì' }],
      [],
    ])
  })
})

describe('spread layout invariants', () => {
  it('does not mutate its inputs', () => {
    const units = [zhuang, comma, li]
    const unitsBefore = structuredClone(units)
    resolveSpreadUnitLayout(units)
    expect(units).toStrictEqual(unitsBefore)

    const segments = [
      qian,
      chuang,
      seg({
        charStart: 2,
        charEnd: 3,
        kana: 'míngyuè',
        perKanji: [
          { charStart: 3, charEnd: 3, kana: 'yuè' },
          { charStart: 2, charEnd: 2, kana: 'míng' },
        ],
      }),
    ]
    const segmentsBefore = structuredClone(segments)
    resolveSpreadSegmentLayout(segments, longText)
    expect(segments).toStrictEqual(segmentsBefore)
  })
})
