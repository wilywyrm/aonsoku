import { describe, expect, it } from 'vitest'
import type { RenderUnit, RubyLineSegment } from '@/types/furigana'
import type {
  NormalizedCue,
  NormalizedStructuredLyric,
} from '@/utils/wordTiming'
import { alignPronunciation } from './alignPronunciation'
import { boundaryCollides } from './grouping'
import { resolveSegmentLayout, resolveUnitLayout } from './layout'
import { buildLineRenderSpans } from './lineRuby'
import { reconcile } from './reconcile'
import { computeWipeLayout, unitWipePct } from './wipeFront'

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

// A one-line track of explicitly timed cues, shaped like a lyricsfile payload:
// the line value is the cue values in order, and byte offsets run over it with
// an INCLUSIVE byteEnd (reconcile treats an exclusive one as malformed and
// drops the ruby). Each cue keeps its own end; none is derived.
function makeTrack(
  cues: Array<{ value: string; start: number; end: number }>,
): NormalizedStructuredLyric {
  let running = 0
  const timed: NormalizedCue[] = cues.map(({ value, start, end }) => {
    const len = new TextEncoder().encode(value).length
    const byteStart = running
    const byteEnd = running + len - 1
    running += len
    return { start, end, value, byteStart, byteEnd }
  })
  const value = cues.map((c) => c.value).join('')
  const start = timed[0].start
  const end = timed[timed.length - 1].end
  return {
    kind: 'main',
    synced: true,
    agents: [],
    hasWordTiming: true,
    breaks: [],
    lines: [
      {
        start,
        end,
        value,
        cueLines: [
          {
            lineIndex: 0,
            key: '0:pos0',
            displayOrder: 0,
            start,
            end,
            value,
            cues: timed,
          },
        ],
      },
    ],
  }
}

describe('resolveUnitLayout shift-first loop', () => {
  it('word: 妄想戦上のルーティン — no merges, じょう shifts right (E1)', () => {
    const result = resolveUnitLayout(routine.units, routine.text)
    expect(result.units).toEqual(routine.units)
    expect(result.groups.slice(0, 3)).toEqual([
      [{ start: 0, end: 0, kana: 'もう' }],
      [{ start: 0, end: 0, kana: 'そう' }],
      [{ start: 0, end: 0, kana: 'せん' }],
    ])
    expect(result.groups[3]).toHaveLength(1)
    expect(result.groups[3][0].shift).toBeCloseTo(0.25, 4)
    expect(result.groups[3][0].tracking).toBeUndefined()
    expect(result.groups.slice(4)).toEqual([[], [], [], [], [], []])
  })

  it('word pipeline: 妄想戦上のルーティン from real cue data (E1)', () => {
    const starts = [
      101881, 102183, 102729, 102910, 103052, 103254, 103436, 103577, 103637,
      103799,
    ]
    const ends = [
      102183, 102729, 102910, 103052, 103254, 103436, 103577, 103637, 103799,
      103900,
    ]
    const timed = (values: string[]) =>
      values.map((value, i) => ({ value, start: starts[i], end: ends[i] }))
    const text = '妄想戦上のルーティン'
    const main = makeTrack(timed([...text]))
    const pron = makeTrack(
      timed(['もう', 'そう', 'せん', 'じょう', ...'のルーティン']),
    )

    const [model] = alignPronunciation(main, pron)
    const units = reconcile(model, main.lines[0].cueLines[0].cues, text)
    const result = resolveUnitLayout(units, text)

    expect(result.units).toHaveLength(10)
    const ruby = result.units.filter((u) => u.kana !== undefined)
    expect(ruby.map((u) => u.kana)).toEqual(['もう', 'そう', 'せん', 'じょう'])
    for (const u of ruby) {
      expect(u.coveringCueIdx).toHaveLength(1)
      expect(u.charEnd).toBe(u.charStart)
    }
    expect(result.units[3]).toMatchObject({ kanjiText: '上', kana: 'じょう' })
    expect(result.groups[3][0].shift).toBeCloseTo(0.25, 4)
    for (const g of result.groups.flat()) expect(g.tracking).toBeUndefined()
  })

  it('word: 妄想戦上 merges leftovers leftmost-first (E2)', () => {
    // The line ends at 上, so じょう has no room to shift into.
    const units = routine.units.slice(0, 4)
    const result = resolveUnitLayout(units, '妄想戦上')

    expect(result.units).toHaveLength(2)
    expect(result.units[0]).toEqual(units[0])
    expect(result.units[1]).toEqual({
      charStart: 1,
      charEnd: 3,
      kanjiText: '想戦上',
      kana: 'そうせんじょう',
      nonSplittable: false,
      coveringCueIdx: [1, 2, 3],
      cueCharCounts: [1, 1, 1],
      perKanji: [
        { charStart: 1, charEnd: 1, kana: 'そう' },
        { charStart: 2, charEnd: 2, kana: 'せん' },
        { charStart: 3, charEnd: 3, kana: 'じょう' },
      ],
    })
    expect(result.groups[0]).toEqual([
      { start: 0, end: 0, kana: 'もう', tracking: -0.1429 },
    ])
    expect(result.groups[1]).toEqual([
      { start: 0, end: 2, kana: 'そうせんじょう', tracking: -0.1429 },
    ])

    const layout = computeWipeLayout(result.units, 4)
    expect(layout).toEqual({
      unitOffset: [0, 1],
      unitWidth: [1, 3],
      cueStart: [0, 1, 2, 3],
      cueChars: [1, 1, 1, 1],
    })
    expect(unitWipePct(2.5, 1, layout)).toBeCloseTo(50, 5)
  })

  it('word: 心構えても — かま shifts instead of merging (E3)', () => {
    const result = resolveUnitLayout(kokorogamae.units, kokorogamae.text)
    expect(result.units.map((u) => u.kanjiText)).toEqual([
      '心',
      '構え',
      'て',
      'も',
    ])
    expect(result.units[1]).toMatchObject({
      charStart: 1,
      charEnd: 2,
      kanjiText: '構え',
      kana: 'かま',
      coveringCueIdx: [1],
      cueCharCounts: [2],
      perKanji: [{ charStart: 1, charEnd: 1, kana: 'かま' }],
    })
    expect(result.groups[0]).toEqual([{ start: 0, end: 0, kana: 'こころ' }])
    expect(result.groups[1][0].shift).toBeCloseTo(0.25, 4)
  })

  it('word: rounding residual does not merge (E8)', () => {
    const units = [
      unit({
        charStart: 0,
        charEnd: 2,
        kanjiText: '一二三',
        kana: 'あいうえおか',
        nonSplittable: true,
        coveringCueIdx: [0],
        cueCharCounts: [3],
      }),
      unit({
        charStart: 3,
        charEnd: 4,
        kanjiText: '四五',
        kana: 'きくけこさ',
        nonSplittable: true,
        coveringCueIdx: [1],
        cueCharCounts: [2],
      }),
    ]
    const result = resolveUnitLayout(units, '一二三四五')
    expect(result.units).toHaveLength(2)
    expect(result.groups[0][0].tracking).toBe(-0.1111)
    expect(result.groups[1][0].tracking).toBe(-0.1111)
  })

  it('word: never merges across okurigana, even after absorb (E9)', () => {
    const text = '一の二'
    const units = [
      unit({
        charStart: 0,
        charEnd: 0,
        kanjiText: '一',
        kana: 'あいうえおか',
        nonSplittable: true,
        coveringCueIdx: [0],
      }),
      unit({ charStart: 1, charEnd: 1, kanjiText: 'の', coveringCueIdx: [0] }),
      unit({
        charStart: 2,
        charEnd: 2,
        kanjiText: '二',
        kana: 'かきくけこ',
        nonSplittable: true,
        coveringCueIdx: [1],
      }),
    ]
    const result = resolveUnitLayout(units, text)

    expect(result.units).toHaveLength(2)
    expect(result.units.map((u) => u.kanjiText)).toEqual(['一の', '二'])
    expect(result.groups[0][0].tracking).toBe(-0.15)
    expect(result.groups[1][0].tracking).toBe(-0.15)
    // Absorbing の makes the two ruby units contiguous and they still
    // overlap, yet they stay apart.
    expect(
      boundaryCollides(
        { groups: result.groups[0], baseOffset: result.units[0].charStart },
        { groups: result.groups[1], baseOffset: result.units[1].charStart },
        text,
      ),
    ).toBe(true)
  })

  it('word: never merges across a space (E7)', () => {
    const result = resolveUnitLayout(hyouhyou.units, hyouhyou.text)
    expect(result.units).toHaveLength(3)
    expect(result.groups[0][0].tracking).toBe(-0.15)
    expect(result.groups[2][0].tracking).toBe(-0.15)
  })
})

describe('resolveSegmentLayout shift-first loop', () => {
  it('line: 妄想戦上のルーティン — じょう shifts right (E1)', () => {
    const segments = [
      seg({ charStart: 0, charEnd: 0, kana: 'もう', nonSplittable: true }),
      seg({ charStart: 1, charEnd: 1, kana: 'そう', nonSplittable: true }),
      seg({ charStart: 2, charEnd: 2, kana: 'せん', nonSplittable: true }),
      seg({ charStart: 3, charEnd: 3, kana: 'じょう', nonSplittable: true }),
    ]
    const result = resolveSegmentLayout(segments, routine.text)

    expect(result.segments).toEqual(segments)
    expect(result.groups.slice(0, 3)).toEqual([
      [{ start: 0, end: 0, kana: 'もう' }],
      [{ start: 1, end: 1, kana: 'そう' }],
      [{ start: 2, end: 2, kana: 'せん' }],
    ])
    expect(result.groups[3][0].shift).toBeCloseTo(0.25, 4)
    expect(result.groups[3][0].tracking).toBeUndefined()
  })

  it('line: 心姿力 chain collapses to one group (E4)', () => {
    const segments = [
      seg({
        charStart: 0,
        charEnd: 0,
        kana: 'こころ',
        perKanji: [{ charStart: 0, charEnd: 0, kana: 'こころ' }],
      }),
      seg({
        charStart: 1,
        charEnd: 1,
        kana: 'すがた',
        perKanji: [{ charStart: 1, charEnd: 1, kana: 'すがた' }],
      }),
      seg({
        charStart: 2,
        charEnd: 2,
        kana: 'ちから',
        perKanji: [{ charStart: 2, charEnd: 2, kana: 'ちから' }],
      }),
    ]
    const result = resolveSegmentLayout(segments, '心姿力')

    expect(result.segments).toEqual([
      {
        charStart: 0,
        charEnd: 2,
        kana: 'こころすがたちから',
        nonSplittable: false,
        perKanji: [
          { charStart: 0, charEnd: 0, kana: 'こころ' },
          { charStart: 1, charEnd: 1, kana: 'すがた' },
          { charStart: 2, charEnd: 2, kana: 'ちから' },
        ],
      },
    ])
    expect(result.groups).toEqual([
      [{ start: 0, end: 2, kana: 'こころすがたちから' }],
    ])
  })

  it('line: 心技 still merges (E5)', () => {
    const result = resolveSegmentLayout(shingi.segments, shingi.text)
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].kana).toBe('こころわざ')
  })

  it('line: 少々出来 shifts で instead of merging (E6)', () => {
    const result = resolveSegmentLayout(shoushou.segments, shoushou.text)
    expect(result.segments).toEqual(shoushou.segments)
    expect(result.groups[1]).toEqual([
      { start: 2, end: 2, kana: 'で', shift: expect.closeTo(0.25, 4) },
      { start: 3, end: 3, kana: 'き' },
    ])
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
