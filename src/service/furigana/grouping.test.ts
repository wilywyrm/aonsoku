import { describe, expect, it } from 'vitest'
import type { RenderUnit } from '@/types/furigana'
import { groupReadings, mergeCollidingUnits, readingsCollide } from './grouping'

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

describe('readingsCollide', () => {
  it('true when a wide reading overhangs into the next', () => {
    // こころ (3 mora) over 1 kanji overhangs 0.25em into 構's reading かま.
    expect(
      readingsCollide(
        { start: 0, end: 0, kana: 'こころ' },
        { start: 1, end: 1, kana: 'かま' },
      ),
    ).toBe(true)
  })

  it('false when readings sit edge-to-edge (no overlap)', () => {
    // Two 2-mora readings each exactly one kanji wide: they touch, not overlap.
    expect(
      readingsCollide(
        { start: 0, end: 0, kana: 'とう' },
        { start: 1, end: 1, kana: 'かい' },
      ),
    ).toBe(false)
  })

  it('false when a narrow reading leaves a clear gap', () => {
    expect(
      readingsCollide(
        { start: 0, end: 0, kana: 'な' },
        { start: 1, end: 1, kana: 'まえ' },
      ),
    ).toBe(false)
  })
})

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

  it('is transitive (a widened group absorbs the next reading)', () => {
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
})

describe('mergeCollidingUnits', () => {
  it('merges 心 + 構え (split across cues by ても) into one multi-cue unit', () => {
    const units = mergeCollidingUnits([
      unit({
        charStart: 0,
        charEnd: 0,
        kanjiText: '心',
        kana: 'こころ',
        coveringCueIdx: [0],
        cueCharCounts: [1],
        perKanji: [{ charStart: 0, charEnd: 0, kana: 'こころ' }],
      }),
      unit({
        charStart: 1,
        charEnd: 2,
        kanjiText: '構え',
        kana: 'かま',
        coveringCueIdx: [1],
        cueCharCounts: [2],
        perKanji: [{ charStart: 1, charEnd: 1, kana: 'かま' }],
      }),
      unit({ charStart: 3, charEnd: 3, kanjiText: 'て', coveringCueIdx: [2] }),
      unit({ charStart: 4, charEnd: 4, kanjiText: 'も', coveringCueIdx: [3] }),
    ])

    expect(units).toHaveLength(3)
    expect(units[0]).toMatchObject({
      charStart: 0,
      charEnd: 2,
      kanjiText: '心構え',
      kana: 'こころかま',
      coveringCueIdx: [0, 1],
      cueCharCounts: [1, 2],
      perKanji: [
        { charStart: 0, charEnd: 0, kana: 'こころ' },
        { charStart: 1, charEnd: 1, kana: 'かま' },
      ],
    })
    expect(units[1].kanjiText).toBe('て')
    expect(units[2].kanjiText).toBe('も')
  })

  it('does not merge non-colliding adjacent kanji units', () => {
    const units = mergeCollidingUnits([
      unit({
        charStart: 0,
        charEnd: 0,
        kanjiText: '名',
        kana: 'な',
        coveringCueIdx: [0],
        perKanji: [{ charStart: 0, charEnd: 0, kana: 'な' }],
      }),
      unit({
        charStart: 1,
        charEnd: 1,
        kanjiText: '前',
        kana: 'まえ',
        coveringCueIdx: [1],
        perKanji: [{ charStart: 1, charEnd: 1, kana: 'まえ' }],
      }),
    ])
    expect(units).toHaveLength(2)
  })

  it('does not merge across a bare (reading-less) unit', () => {
    const units = mergeCollidingUnits([
      unit({
        charStart: 0,
        charEnd: 0,
        kanjiText: '心',
        kana: 'こころ',
        coveringCueIdx: [0],
        perKanji: [{ charStart: 0, charEnd: 0, kana: 'こころ' }],
      }),
      unit({ charStart: 1, charEnd: 1, kanjiText: 'の', coveringCueIdx: [1] }),
      unit({
        charStart: 2,
        charEnd: 2,
        kanjiText: '構',
        kana: 'かま',
        coveringCueIdx: [2],
        perKanji: [{ charStart: 2, charEnd: 2, kana: 'かま' }],
      }),
    ])
    expect(units).toHaveLength(3)
  })

  it('does not merge non-contiguous kanji units', () => {
    const units = mergeCollidingUnits([
      unit({
        charStart: 0,
        charEnd: 0,
        kanjiText: '心',
        kana: 'こころ',
        coveringCueIdx: [0],
        perKanji: [{ charStart: 0, charEnd: 0, kana: 'こころ' }],
      }),
      unit({
        charStart: 2,
        charEnd: 2,
        kanjiText: '技',
        kana: 'わざ',
        coveringCueIdx: [1],
        perKanji: [{ charStart: 2, charEnd: 2, kana: 'わざ' }],
      }),
    ])
    expect(units).toHaveLength(2)
  })
})
