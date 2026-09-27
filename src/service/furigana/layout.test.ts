import { describe, expect, it } from 'vitest'
import type { RenderUnit, RubyLineSegment } from '@/types/furigana'
import {
  absorbOkurigana,
  condenseAcrossGaps,
  mergeCollidingSegments,
  mergeCollidingUnits,
  resolveSegmentGroups,
  resolveUnitGroups,
  shiftAcrossGaps,
} from './grouping'
import { resolveSegmentLayout, resolveUnitLayout } from './layout'
import { buildLineRenderSpans } from './lineRuby'

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

// One unit per char, each in its own cue: four kanji read whole (no perKanji),
// then the bare の + katakana tail.
const routine = {
  text: '妄想戦上のルーティン',
  units: [
    unit({
      charStart: 0,
      charEnd: 0,
      kanjiText: '妄',
      kana: 'もう',
      nonSplittable: true,
      coveringCueIdx: [0],
    }),
    unit({
      charStart: 1,
      charEnd: 1,
      kanjiText: '想',
      kana: 'そう',
      nonSplittable: true,
      coveringCueIdx: [1],
    }),
    unit({
      charStart: 2,
      charEnd: 2,
      kanjiText: '戦',
      kana: 'せん',
      nonSplittable: true,
      coveringCueIdx: [2],
    }),
    unit({
      charStart: 3,
      charEnd: 3,
      kanjiText: '上',
      kana: 'じょう',
      nonSplittable: true,
      coveringCueIdx: [3],
    }),
    unit({ charStart: 4, charEnd: 4, kanjiText: 'の', coveringCueIdx: [4] }),
    unit({ charStart: 5, charEnd: 5, kanjiText: 'ル', coveringCueIdx: [5] }),
    unit({ charStart: 6, charEnd: 6, kanjiText: 'ー', coveringCueIdx: [6] }),
    unit({ charStart: 7, charEnd: 7, kanjiText: 'テ', coveringCueIdx: [7] }),
    unit({ charStart: 8, charEnd: 8, kanjiText: 'ィ', coveringCueIdx: [8] }),
    unit({ charStart: 9, charEnd: 9, kanjiText: 'ン', coveringCueIdx: [9] }),
  ],
}

// 構 and its okurigana え share cue 1; 構 is splittable but has no perKanji.
const kokorogamae = {
  text: '心構えても',
  units: [
    unit({
      charStart: 0,
      charEnd: 0,
      kanjiText: '心',
      kana: 'こころ',
      nonSplittable: true,
      coveringCueIdx: [0],
    }),
    unit({
      charStart: 1,
      charEnd: 1,
      kanjiText: '構',
      kana: 'かま',
      coveringCueIdx: [1],
    }),
    unit({ charStart: 2, charEnd: 2, kanjiText: 'え', coveringCueIdx: [1] }),
    unit({ charStart: 3, charEnd: 3, kanjiText: 'て', coveringCueIdx: [2] }),
    unit({ charStart: 4, charEnd: 4, kanjiText: 'も', coveringCueIdx: [3] }),
  ],
}

// Two readings facing each other across a narrow ASCII space, in both models.
const hyouhyou = {
  text: '飄々 霞',
  units: [
    unit({
      charStart: 0,
      charEnd: 1,
      kanjiText: '飄々',
      kana: 'ひょうひょう',
      nonSplittable: true,
      coveringCueIdx: [0],
      cueCharCounts: [2],
    }),
    unit({ charStart: 2, charEnd: 2, kanjiText: ' ', coveringCueIdx: [1] }),
    unit({
      charStart: 3,
      charEnd: 3,
      kanjiText: '霞',
      kana: 'かすみ',
      nonSplittable: true,
      coveringCueIdx: [2],
    }),
  ],
  segments: [
    seg({
      charStart: 0,
      charEnd: 1,
      kana: 'ひょうひょう',
      nonSplittable: true,
    }),
    seg({ charStart: 3, charEnd: 3, kana: 'かすみ', nonSplittable: true }),
  ],
}

// こころ overhangs わざ across two separately tokenized words.
const shingi = {
  text: '心技',
  segments: [
    seg({
      charStart: 0,
      charEnd: 0,
      kana: 'こころ',
      perKanji: [{ charStart: 0, charEnd: 0, kana: 'こころ' }],
    }),
    seg({
      charStart: 1,
      charEnd: 1,
      kana: 'わざ',
      perKanji: [{ charStart: 1, charEnd: 1, kana: 'わざ' }],
    }),
  ],
}

// 少々's grouped reading overhangs into 出来.
const shoushou = {
  text: '少々出来すぎ',
  segments: [
    seg({
      charStart: 0,
      charEnd: 1,
      kana: 'しょうしょう',
      perKanji: [
        { charStart: 0, charEnd: 0, kana: 'しょう' },
        { charStart: 1, charEnd: 1, kana: 'しょう' },
      ],
    }),
    seg({
      charStart: 2,
      charEnd: 3,
      kana: 'でき',
      perKanji: [
        { charStart: 2, charEnd: 2, kana: 'で' },
        { charStart: 3, charEnd: 3, kana: 'き' },
      ],
    }),
  ],
}

// B overlaps A; C overlaps only B, so dropping B must not take C with it.
const chainText = '一二三四五'
const chainA = seg({
  charStart: 0,
  charEnd: 1,
  kana: 'いちに',
  nonSplittable: true,
})
const chainB = seg({
  charStart: 1,
  charEnd: 4,
  kana: 'にさんしご',
  nonSplittable: true,
})
const chainC = seg({
  charStart: 3,
  charEnd: 3,
  kana: 'し',
  perKanji: [{ charStart: 3, charEnd: 3, kana: 'し' }],
})

// The word-level pipeline before extraction, inlined: the container memo's merge
// + absorb, then RubyCueContent's resolve + shift + condense.
function unitPipeline(units: RenderUnit[], text: string) {
  const merged = absorbOkurigana(mergeCollidingUnits(units))
  const groups = merged.map(resolveUnitGroups)
  const items = merged
    .map((u, i) => ({ groups: groups[i], baseOffset: u.charStart }))
    .filter((item) => item.groups.length > 0)
  shiftAcrossGaps(items, text)
  condenseAcrossGaps(items, text)
  return { units: merged, groups }
}

// The line-level pipeline before extraction, inlined from buildLineRenderSpans.
function segmentPipeline(segments: RubyLineSegment[], text: string) {
  const merged = mergeCollidingSegments(
    [...segments].sort((a, b) => a.charStart - b.charStart),
  )
  const groups = merged.map(resolveSegmentGroups)
  const items = groups
    .map((g) => ({ groups: g, baseOffset: 0 }))
    .filter((item) => item.groups.length > 0)
  shiftAcrossGaps(items, text)
  condenseAcrossGaps(items, text)
  return { segments: merged, groups }
}

describe('composition parity (replaced in Task 4)', () => {
  // Each reference runs on its own copy of the input, so the two sides share no
  // objects.
  it('resolveUnitLayout matches the pre-extraction pipeline (妄想戦上のルーティン)', () => {
    const { text, units } = routine
    expect(resolveUnitLayout(units, text)).toEqual(
      unitPipeline(structuredClone(units), text),
    )
  })

  it('resolveUnitLayout matches the pre-extraction pipeline (心構えても)', () => {
    const { text, units } = kokorogamae
    expect(resolveUnitLayout(units, text)).toEqual(
      unitPipeline(structuredClone(units), text),
    )
  })

  it('resolveUnitLayout matches the pre-extraction pipeline (飄々 霞)', () => {
    const { text, units } = hyouhyou
    expect(resolveUnitLayout(units, text)).toEqual(
      unitPipeline(structuredClone(units), text),
    )
  })

  it('resolveSegmentLayout matches the pre-extraction pipeline (心技)', () => {
    const { text, segments } = shingi
    expect(resolveSegmentLayout(segments, text)).toEqual(
      segmentPipeline(structuredClone(segments), text),
    )
  })

  it('resolveSegmentLayout matches the pre-extraction pipeline (少々出来すぎ)', () => {
    const { text, segments } = shoushou
    expect(resolveSegmentLayout(segments, text)).toEqual(
      segmentPipeline(structuredClone(segments), text),
    )
  })

  it('resolveSegmentLayout matches the pre-extraction pipeline (飄々 霞)', () => {
    const { text, segments } = hyouhyou
    expect(resolveSegmentLayout(segments, text)).toEqual(
      segmentPipeline(structuredClone(segments), text),
    )
  })
})

describe('resolveSegmentLayout keep-first filter', () => {
  it('drops a fully-overlapping duplicate segment (東京都)', () => {
    const tokyo = seg({
      charStart: 0,
      charEnd: 1,
      kana: 'とうきょう',
      nonSplittable: true,
    })
    const kyou = seg({
      charStart: 1,
      charEnd: 1,
      kana: 'きょう',
      nonSplittable: true,
    })
    const result = resolveSegmentLayout([tokyo, kyou], '東京都')
    expect(result.segments).toEqual([tokyo])
    expect(result.groups).toHaveLength(1)
  })

  it('keeps a segment after a dropped overlapping one, in charStart order (chained overlap)', () => {
    // Fed in reverse, so the filter only keeps A and C if it sorts first.
    const result = resolveSegmentLayout([chainC, chainB, chainA], chainText)
    expect(result.segments).toEqual([chainA, chainC])
    // B is gone before layout, so it can't push A or C off-centre.
    expect(result.groups).toEqual([
      [{ start: 0, end: 1, kana: 'いちに' }],
      [{ start: 3, end: 3, kana: 'し' }],
    ])
  })

  it('buildLineRenderSpans drops a chained overlap before layout', () => {
    const spans = buildLineRenderSpans(chainText, {
      segments: [chainA, chainB, chainC],
    })
    expect(spans).toEqual([
      { text: '一二', kana: 'いちに' },
      { text: '三' },
      { text: '四', kana: 'し', cells: [{ text: '四', kana: 'し' }] },
      { text: '五' },
    ])
    expect(spans.map((s) => s.text).join('')).toBe(chainText)
  })
})

describe('layout invariants', () => {
  it('does not mutate its inputs', () => {
    for (const { text, units } of [routine, kokorogamae, hyouhyou]) {
      const before = structuredClone(units)
      resolveUnitLayout(units, text)
      expect(units).toEqual(before)
    }
    const segmentCases = [
      shingi,
      shoushou,
      hyouhyou,
      // Unsorted input: sorting and filtering must work on a copy.
      { text: chainText, segments: [chainC, chainB, chainA] },
      {
        text: '取り引き',
        segments: [
          seg({
            charStart: 0,
            charEnd: 3,
            kana: 'とりひき',
            perKanji: [
              { charStart: 2, charEnd: 2, kana: 'ひ' },
              { charStart: 0, charEnd: 0, kana: 'と' },
            ],
          }),
        ],
      },
    ]
    for (const { text, segments } of segmentCases) {
      const before = structuredClone(segments)
      resolveSegmentLayout(segments, text)
      expect(segments).toEqual(before)
    }
  })

  it('groups run parallel to items (妄想戦上のルーティン)', () => {
    const { units, groups } = resolveUnitLayout(routine.units, routine.text)
    expect(groups).toHaveLength(units.length)
    // Bare units keep an empty slot instead of being skipped, so indices line up.
    expect(groups.map((g) => g.length === 0)).toEqual(
      units.map((u) => u.kana === undefined),
    )
  })
})
