import { describe, expect, it } from 'vitest'
import type { RenderUnit, RubyLineSegment } from '@/types/furigana'
import {
  absorbOkurigana,
  boundaryCollides,
  condenseAcrossGaps,
  groupReadings,
  mergeSegmentPair,
  mergeUnitPair,
  type ReadingGroup,
  type ReadingItem,
  resolveUnitGroups,
  shiftAcrossGaps,
} from './grouping'

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

describe('groupReadings', () => {
  it('merges colliding per-kanji readings into one group-ruby span', () => {
    const groups = groupReadings(
      [
        { charStart: 0, charEnd: 0, kana: 'こころ' },
        { charStart: 1, charEnd: 1, kana: 'がま' },
      ],
      0,
    )
    expect(groups).toEqual([{ start: 0, end: 1, kana: 'こころがま' }])
  })

  it('keeps non-colliding readings as separate mono-ruby spans', () => {
    const groups = groupReadings(
      [
        { charStart: 0, charEnd: 0, kana: 'な' },
        { charStart: 1, charEnd: 1, kana: 'まえ' },
      ],
      0,
    )
    expect(groups).toEqual([
      { start: 0, end: 0, kana: 'な' },
      { start: 1, end: 1, kana: 'まえ' },
    ])
  })

  it('merges a chain that still overlaps even fully condensed', () => {
    // At the floor these 3+2+2-mora readings can't be tracked apart, so the
    // whole run collapses to one group-ruby.
    const groups = groupReadings(
      [
        { charStart: 0, charEnd: 0, kana: 'こころ' },
        { charStart: 1, charEnd: 1, kana: 'がま' },
        { charStart: 2, charEnd: 2, kana: 'かた' },
      ],
      0,
    )
    expect(groups).toEqual([{ start: 0, end: 2, kana: 'こころがまかた' }])
  })

  it('condenses colliding readings within the floor instead of merging', () => {
    // 5-kana reading over 2 kanji meeting a 4-kana reading over 2 kanji overhangs
    // only 0.25em — cleared by tracking both ~-0.143 rt-em, so they stay separate
    // mono-ruby cells instead of merging into one group-ruby span.
    const groups = groupReadings(
      [
        { charStart: 0, charEnd: 1, kana: 'かきくけこ' },
        { charStart: 2, charEnd: 3, kana: 'さしすせ' },
      ],
      0,
    )
    expect(groups).toEqual([
      { start: 0, end: 1, kana: 'かきくけこ', tracking: -0.1429 },
      { start: 2, end: 3, kana: 'さしすせ', tracking: -0.1429 },
    ])
  })

  it('merges when condensing to the floor cannot clear the overlap (飄々)', () => {
    // 飄 + 々 (both ひょう, 3 mora over 1 kanji, already fused by the shift-first
    // loop in layout.ts) overlap 0.5em — ~33% each to fit, far past the floor —
    // so they fall back to one centred group-ruby span.
    const groups = groupReadings(
      [
        { charStart: 0, charEnd: 0, kana: 'ひょう' },
        { charStart: 1, charEnd: 1, kana: 'ひょう' },
      ],
      0,
    )
    expect(groups).toEqual([{ start: 0, end: 1, kana: 'ひょうひょう' }])
  })
})

describe('mergeUnitPair', () => {
  it('sums a shared boundary cue char count', () => {
    const a = unit({
      charStart: 0,
      charEnd: 1,
      kanjiText: '今日',
      kana: 'きょう',
      coveringCueIdx: [0, 1],
      cueCharCounts: [1, 1],
    })
    const b = unit({
      charStart: 2,
      charEnd: 3,
      kanjiText: '天気',
      kana: 'てんき',
      coveringCueIdx: [1, 2],
      cueCharCounts: [1, 1],
    })
    expect(mergeUnitPair(a, b)).toEqual({
      charStart: 0,
      charEnd: 3,
      kanjiText: '今日天気',
      kana: 'きょうてんき',
      nonSplittable: false,
      coveringCueIdx: [0, 1, 2],
      cueCharCounts: [1, 2, 1],
      perKanji: [
        { charStart: 0, charEnd: 1, kana: 'きょう' },
        { charStart: 2, charEnd: 3, kana: 'てんき' },
      ],
    })
  })
})

describe('mergeSegmentPair', () => {
  it('synthesizes a whole-span reading when merging a jukujikun', () => {
    const a = seg({
      charStart: 0,
      charEnd: 0,
      kana: 'あいう',
      nonSplittable: true,
    })
    const b = seg({
      charStart: 1,
      charEnd: 1,
      kana: 'かい',
      perKanji: [{ charStart: 1, charEnd: 1, kana: 'かい' }],
    })
    expect(mergeSegmentPair(a, b)).toEqual({
      charStart: 0,
      charEnd: 1,
      kana: 'あいうかい',
      nonSplittable: false,
      perKanji: [
        { charStart: 0, charEnd: 0, kana: 'あいう' },
        { charStart: 1, charEnd: 1, kana: 'かい' },
      ],
    })
  })
})

describe('absorbOkurigana', () => {
  it('folds trailing okurigana into the ruby unit (嫌 + っ → 嫌っ)', () => {
    const units = absorbOkurigana([
      unit({
        charStart: 0,
        charEnd: 0,
        kanjiText: '嫌',
        kana: 'きら',
        coveringCueIdx: [0],
        cueCharCounts: [1],
      }),
      unit({
        charStart: 1,
        charEnd: 1,
        kanjiText: 'っ',
        coveringCueIdx: [0],
        cueCharCounts: [1],
      }),
    ])

    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({
      charStart: 0,
      charEnd: 1,
      kanjiText: '嫌っ',
      kana: 'きら',
      coveringCueIdx: [0],
      cueCharCounts: [2],
      perKanji: [{ charStart: 0, charEnd: 0, kana: 'きら' }],
    })
  })

  it('folds leading okurigana into the ruby unit (お + 茶 → お茶)', () => {
    const units = absorbOkurigana([
      unit({
        charStart: 0,
        charEnd: 0,
        kanjiText: 'お',
        coveringCueIdx: [0],
        cueCharCounts: [1],
      }),
      unit({
        charStart: 1,
        charEnd: 1,
        kanjiText: '茶',
        kana: 'ちゃ',
        coveringCueIdx: [0],
        cueCharCounts: [1],
      }),
    ])

    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({
      charStart: 0,
      charEnd: 1,
      kanjiText: 'お茶',
      kana: 'ちゃ',
      coveringCueIdx: [0],
      cueCharCounts: [2],
      perKanji: [{ charStart: 1, charEnd: 1, kana: 'ちゃ' }],
    })
  })

  it('does not fold a bare unit from a different cue', () => {
    const units = absorbOkurigana([
      unit({
        charStart: 0,
        charEnd: 0,
        kanjiText: '嫌',
        kana: 'きら',
        coveringCueIdx: [0],
        cueCharCounts: [1],
      }),
      unit({
        charStart: 1,
        charEnd: 1,
        kanjiText: 'て',
        coveringCueIdx: [1],
        cueCharCounts: [1],
      }),
    ])

    expect(units).toHaveLength(2)
  })

  it('does not fold okurigana into a multi-cue (straddling) ruby unit', () => {
    const units = absorbOkurigana([
      unit({
        charStart: 0,
        charEnd: 1,
        kanjiText: '今日',
        kana: 'きょう',
        coveringCueIdx: [0, 1],
        cueCharCounts: [1, 1],
      }),
      unit({
        charStart: 2,
        charEnd: 2,
        kanjiText: 'は',
        coveringCueIdx: [1],
        cueCharCounts: [1],
      }),
    ])

    expect(units).toHaveLength(2)
  })

  it('does not fold whitespace into the ruby unit', () => {
    const units = absorbOkurigana([
      unit({
        charStart: 0,
        charEnd: 0,
        kanjiText: '好',
        kana: 'す',
        coveringCueIdx: [0],
        cueCharCounts: [1],
      }),
      unit({
        charStart: 1,
        charEnd: 1,
        kanjiText: ' ',
        coveringCueIdx: [0],
        cueCharCounts: [1],
      }),
    ])

    expect(units).toHaveLength(2)
  })
})

describe('condenseAcrossGaps', () => {
  function item(groups: ReadingGroup[], baseOffset = 0) {
    return { groups, baseOffset }
  }

  it('condenses both readings overhanging a narrow ASCII space (飄々 ␣ 霞)', () => {
    // 飄々 renders as one group-ruby ひょうひょう (overhangs 0.5em); 霞's かすみ
    // overhangs 0.25em; across the ~0.2em ASCII space they overlap ~0.55em, so
    // both track down to the floor (residual accepted, never merged).
    const left = item([{ start: 3, end: 4, kana: 'ひょうひょう' }])
    const right = item([{ start: 6, end: 6, kana: 'かすみ' }])
    condenseAcrossGaps([left, right], 'ひらり飄々 霞掛かる鼓動')
    expect(left.groups[0].tracking).toBe(-0.15)
    expect(right.groups[0].tracking).toBe(-0.15)
  })

  it('leaves readings alone across a full-width space (U+3000)', () => {
    const left = item([{ start: 3, end: 4, kana: 'ひょうひょう' }])
    const right = item([{ start: 6, end: 6, kana: 'かすみ' }])
    condenseAcrossGaps([left, right], 'ひらり飄々\u3000霞掛かる鼓動')
    expect(left.groups[0].tracking).toBeUndefined()
    expect(right.groups[0].tracking).toBeUndefined()
  })

  it('condenses contiguous readings to the floor when they cannot clear (飄々霞)', () => {
    // With no gap the two overhangs (0.5em + 0.25em) overlap 0.75em, beyond what
    // the floor can shed: both bottom out and the residual is left to the caller.
    const left = item([{ start: 0, end: 1, kana: 'ひょうひょう' }])
    const right = item([{ start: 2, end: 2, kana: 'かすみ' }])
    condenseAcrossGaps([left, right], '飄々霞')
    expect(left.groups[0].tracking).toBe(-0.15)
    expect(right.groups[0].tracking).toBe(-0.15)
  })

  it('fully clears a contiguous overlap within the floor', () => {
    const left = item([{ start: 0, end: 1, kana: 'かきくけこ' }])
    const right = item([{ start: 2, end: 3, kana: 'さしすせ' }])
    condenseAcrossGaps([left, right], '漢字漢字')
    expect(left.groups[0].tracking).toBe(-0.1429)
    expect(right.groups[0].tracking).toBe(-0.1429)
  })
})

describe('resolveUnitGroups', () => {
  it('returns one whole-span group for a jukujikun (no perKanji)', () => {
    expect(
      resolveUnitGroups(unit({ kanjiText: '今日', kana: 'きょう' })),
    ).toEqual([{ start: 0, end: 1, kana: 'きょう' }])
  })

  it('returns [] for a bare (reading-less) unit', () => {
    expect(resolveUnitGroups(unit({ kanjiText: 'の' }))).toEqual([])
  })

  it('groups per-kanji readings in unit-local coords', () => {
    expect(
      resolveUnitGroups(
        unit({
          charStart: 5,
          charEnd: 6,
          kanjiText: '名前',
          kana: 'なまえ',
          perKanji: [
            { charStart: 5, charEnd: 5, kana: 'な' },
            { charStart: 6, charEnd: 6, kana: 'まえ' },
          ],
        }),
      ),
    ).toEqual([
      { start: 0, end: 0, kana: 'な' },
      { start: 1, end: 1, kana: 'まえ' },
    ])
  })
})

describe('shiftAcrossGaps', () => {
  it('symmetrically shifts a wide reading, cascading its blocker, to clear a gap', () => {
    // 飄々→ひょうひょう (overhangs 0.5em) overlaps 霞→かすみ across the ~0.2em ASCII
    // space by 0.55em. Symmetric jidori moves each 0.275em apart; かすみ's right is
    // blocked by 掛→か edge-to-edge, so か rides right 0.275em into かる's empty space.
    const hyou: ReadingGroup = { start: 0, end: 1, kana: 'ひょうひょう' }
    const kasumi: ReadingGroup = { start: 0, end: 0, kana: 'かすみ' }
    const ka: ReadingGroup = { start: 0, end: 0, kana: 'か' }
    const ko: ReadingGroup = { start: 0, end: 0, kana: 'こ' }
    const dou: ReadingGroup = { start: 0, end: 0, kana: 'どう' }
    shiftAcrossGaps(
      [
        { groups: [hyou], baseOffset: 3 },
        { groups: [kasumi], baseOffset: 6 },
        { groups: [ka], baseOffset: 7 },
        { groups: [ko], baseOffset: 10 },
        { groups: [dou], baseOffset: 11 },
      ],
      'ひらり飄々 霞掛かる鼓動',
    )
    expect(hyou.shift).toBeCloseTo(-0.275, 4)
    expect(kasumi.shift).toBeCloseTo(0.275, 4)
    expect(ka.shift).toBeCloseTo(0.275, 4)
    expect(ko.shift).toBeUndefined()
    expect(dou.shift).toBeUndefined()
  })

  it('leaves readings centred when a full-width space gives enough clearance', () => {
    const hyou: ReadingGroup = { start: 0, end: 1, kana: 'ひょうひょう' }
    const kasumi: ReadingGroup = { start: 0, end: 0, kana: 'かすみ' }
    shiftAcrossGaps(
      [
        { groups: [hyou], baseOffset: 3 },
        { groups: [kasumi], baseOffset: 6 },
      ],
      'ひらり飄々\u3000霞掛かる鼓動',
    )
    expect(hyou.shift).toBeUndefined()
    expect(kasumi.shift).toBeUndefined()
  })

  it('shifts only the free side when the other is blocked (妄想戦上のルーティン)', () => {
    // じょう overhangs せん by 0.25em, but せん sits flush against そう and もう
    // back to the line start, so じょう alone takes the whole overlap, moving
    // right over the reading-less の.
    const mou: ReadingGroup = { start: 0, end: 0, kana: 'もう' }
    const sou: ReadingGroup = { start: 0, end: 0, kana: 'そう' }
    const sen: ReadingGroup = { start: 0, end: 0, kana: 'せん' }
    const jou: ReadingGroup = { start: 0, end: 0, kana: 'じょう' }
    shiftAcrossGaps(
      [
        { groups: [mou], baseOffset: 0 },
        { groups: [sou], baseOffset: 1 },
        { groups: [sen], baseOffset: 2 },
        { groups: [jou], baseOffset: 3 },
      ],
      '妄想戦上のルーティン',
    )
    expect(mou.shift).toBeUndefined()
    expect(sou.shift).toBeUndefined()
    expect(sen.shift).toBeUndefined()
    expect(jou.shift).toBeCloseTo(0.25, 4)
  })

  it('shifts left when the right side is blocked by the line end (のの戦上)', () => {
    // Mirror case: じょう already overhangs the line end, so せん takes the whole
    // overlap, moving left over the reading-less の.
    const sen: ReadingGroup = { start: 0, end: 0, kana: 'せん' }
    const jou: ReadingGroup = { start: 0, end: 0, kana: 'じょう' }
    shiftAcrossGaps(
      [
        { groups: [sen], baseOffset: 2 },
        { groups: [jou], baseOffset: 3 },
      ],
      'のの戦上',
    )
    expect(sen.shift).toBeCloseTo(-0.25, 4)
    expect(jou.shift).toBeUndefined()
  })

  it('leaves readings centred when neither side has room (妄想戦上)', () => {
    // せん is blocked back to the line start, じょう by the line end: nothing
    // moves, and the overlap is left for condensation.
    const mou: ReadingGroup = { start: 0, end: 0, kana: 'もう' }
    const sou: ReadingGroup = { start: 0, end: 0, kana: 'そう' }
    const sen: ReadingGroup = { start: 0, end: 0, kana: 'せん' }
    const jou: ReadingGroup = { start: 0, end: 0, kana: 'じょう' }
    shiftAcrossGaps(
      [
        { groups: [mou], baseOffset: 0 },
        { groups: [sou], baseOffset: 1 },
        { groups: [sen], baseOffset: 2 },
        { groups: [jou], baseOffset: 3 },
      ],
      '妄想戦上',
    )
    for (const g of [mou, sou, sen, jou]) expect(g.shift).toBeUndefined()
  })
})

describe('boundaryCollides', () => {
  it('false when readings sit edge-to-edge (東海)', () => {
    expect(
      boundaryCollides(
        { groups: [{ start: 0, end: 0, kana: 'とう' }], baseOffset: 0 },
        { groups: [{ start: 0, end: 0, kana: 'かい' }], baseOffset: 1 },
        '東海',
      ),
    ).toBe(false)
  })

  it('true when a wide reading overhangs the next (心構)', () => {
    expect(
      boundaryCollides(
        { groups: [{ start: 0, end: 0, kana: 'こころ' }], baseOffset: 0 },
        { groups: [{ start: 0, end: 0, kana: 'かま' }], baseOffset: 1 },
        '心構',
      ),
    ).toBe(true)
  })

  it('measures readings at their current shift (妄想戦上の)', () => {
    // Centred, じょう overhangs せん by 0.25em; shifted right by that much the
    // pair only touches.
    const jou: ReadingGroup = { start: 0, end: 0, kana: 'じょう' }
    const left: ReadingItem = {
      groups: [{ start: 0, end: 0, kana: 'せん' }],
      baseOffset: 2,
    }
    const right: ReadingItem = { groups: [jou], baseOffset: 3 }
    expect(boundaryCollides(left, right, '妄想戦上の')).toBe(true)
    jou.shift = 0.25
    expect(boundaryCollides(left, right, '妄想戦上の')).toBe(false)
  })

  it('measures readings at their current tracking (漢字漢字)', () => {
    // At natural width かきくけこ overhangs さしすせ by 0.25em; condensed to the
    // -0.1429 rt-em condenseAcrossGaps assigns this pair, they no longer overlap.
    const kaki: ReadingGroup = { start: 0, end: 1, kana: 'かきくけこ' }
    const sashi: ReadingGroup = { start: 2, end: 3, kana: 'さしすせ' }
    const left: ReadingItem = { groups: [kaki], baseOffset: 0 }
    const right: ReadingItem = { groups: [sashi], baseOffset: 0 }
    expect(boundaryCollides(left, right, '漢字漢字')).toBe(true)
    kaki.tracking = -0.1429
    sashi.tracking = -0.1429
    expect(boundaryCollides(left, right, '漢字漢字')).toBe(false)
  })

  it('tolerates the tracking rounding residual (一二三四五)', () => {
    // Condensation clears this contiguous pair exactly, but both trackings are
    // rounded to -0.1111, leaving a 2.5e-5em overlap that is noise, not a
    // collision.
    expect(
      boundaryCollides(
        {
          groups: [
            { start: 0, end: 2, kana: 'あいうえおか', tracking: -0.1111 },
          ],
          baseOffset: 0,
        },
        {
          groups: [{ start: 0, end: 1, kana: 'きくけこさ', tracking: -0.1111 }],
          baseOffset: 3,
        },
        '一二三四五',
      ),
    ).toBe(false)
  })

  it('reports the geometric overlap even across a space (飄々 霞)', () => {
    // The readings overlap ~0.55em across the narrow space. Never merging across
    // a space is up to the caller; this only measures.
    expect(
      boundaryCollides(
        { groups: [{ start: 0, end: 1, kana: 'ひょうひょう' }], baseOffset: 0 },
        { groups: [{ start: 0, end: 0, kana: 'かすみ' }], baseOffset: 3 },
        '飄々 霞',
      ),
    ).toBe(true)
  })

  it('false when either side has no groups', () => {
    const kokoro: ReadingItem = {
      groups: [{ start: 0, end: 0, kana: 'こころ' }],
      baseOffset: 0,
    }
    const bare: ReadingItem = { groups: [], baseOffset: 1 }
    expect(boundaryCollides(kokoro, bare, '心構')).toBe(false)
    expect(boundaryCollides(bare, kokoro, '心構')).toBe(false)
  })
})
