import { describe, expect, it } from 'vitest'
import type { RenderUnit } from '@/types/furigana'
import { computeWipeLayout, unitWipePct, wipeFrontChar } from './wipeFront'

// Minimal unit: only coveringCueIdx + cueCharCounts drive the wipe layout.
function unit(coveringCueIdx: number[], cueCharCounts: number[]): RenderUnit {
  return {
    charStart: 0,
    charEnd: 0,
    kanjiText: '',
    nonSplittable: false,
    coveringCueIdx,
    cueCharCounts,
  }
}

describe('computeWipeLayout', () => {
  it('lays out several single-cue units in one cue (（ + 遊び)', () => {
    const layout = computeWipeLayout([unit([0], [1]), unit([0], [2])], 1)
    expect(layout.cueChars).toEqual([3])
    expect(layout.cueStart).toEqual([0])
    expect(layout.unitOffset).toEqual([0, 1])
    expect(layout.unitWidth).toEqual([1, 2])
  })

  it('accumulates char offsets across multiple cues', () => {
    const layout = computeWipeLayout([unit([0], [2]), unit([1], [3])], 2)
    expect(layout.cueChars).toEqual([2, 3])
    expect(layout.cueStart).toEqual([0, 2])
    expect(layout.unitOffset).toEqual([0, 2])
    expect(layout.unitWidth).toEqual([2, 3])
  })

  it('places a straddling unit in one shared coordinate space', () => {
    const layout = computeWipeLayout([unit([0, 1], [1, 1])], 2)
    expect(layout.cueChars).toEqual([1, 1])
    expect(layout.cueStart).toEqual([0, 1])
    expect(layout.unitOffset).toEqual([0])
    expect(layout.unitWidth).toEqual([2])
  })
})

describe('wipeFrontChar', () => {
  const layout = computeWipeLayout([unit([0], [3]), unit([1], [2])], 2)

  it('clamps before start and after end', () => {
    expect(wipeFrontChar(-50, 0, 0, 300, layout)).toBeCloseTo(0, 5)
    expect(wipeFrontChar(9999, 0, 0, 300, layout)).toBeCloseTo(3, 5)
  })

  it('is proportional to elapsed time within the active cue', () => {
    expect(wipeFrontChar(100, 0, 0, 300, layout)).toBeCloseTo(1, 5)
    expect(wipeFrontChar(200, 0, 0, 300, layout)).toBeCloseTo(2, 5)
  })

  it('offsets by earlier cues chars when a later cue is active', () => {
    // Cue 1 starts at absolute char 3; halfway through adds 1 of its 2 chars.
    expect(wipeFrontChar(400, 1, 300, 500, layout)).toBeCloseTo(4, 5)
  })

  it('does not divide by zero on a degenerate cue', () => {
    const v = wipeFrontChar(100, 0, 100, 100, layout)
    expect(Number.isFinite(v)).toBe(true)
  })
})

describe('unitWipePct — shared front across a cue', () => {
  it('wipes a leading paren fully before its kanji word starts (（遊び)', () => {
    const layout = computeWipeLayout([unit([0], [1]), unit([0], [2])], 1)
    // Front at char 1 (one third through a 3-char cue): paren done, word idle.
    const front = wipeFrontChar(100, 0, 0, 300, layout)
    expect(unitWipePct(front, 0, layout)).toBeCloseTo(100, 5)
    expect(unitWipePct(front, 1, layout)).toBeCloseTo(0, 5)
    // End of cue: both full.
    const end = wipeFrontChar(300, 0, 0, 300, layout)
    expect(unitWipePct(end, 0, layout)).toBeCloseTo(100, 5)
    expect(unitWipePct(end, 1, layout)).toBeCloseTo(100, 5)
  })

  it('wipes a kanji before its trailing particle within one cue (目に)', () => {
    const layout = computeWipeLayout([unit([0], [1]), unit([0], [1])], 1)
    const mid = wipeFrontChar(100, 0, 0, 200, layout)
    expect(unitWipePct(mid, 0, layout)).toBeCloseTo(100, 5)
    expect(unitWipePct(mid, 1, layout)).toBeCloseTo(0, 5)
  })

  it('fills a straddling unit continuously across the cue boundary', () => {
    const layout = computeWipeLayout([unit([0, 1], [1, 1])], 2)
    const endCue0 = wipeFrontChar(500, 0, 0, 500, layout)
    const startCue1 = wipeFrontChar(500, 1, 500, 1000, layout)
    expect(unitWipePct(endCue0, 0, layout)).toBeCloseTo(50, 5)
    expect(unitWipePct(startCue1, 0, layout)).toBeCloseTo(50, 5)
    const endCue1 = wipeFrontChar(1000, 1, 500, 1000, layout)
    expect(unitWipePct(endCue1, 0, layout)).toBeCloseTo(100, 5)
  })

  it('returns 0 for a zero-width unit', () => {
    const layout = computeWipeLayout([unit([0], [0])], 1)
    expect(unitWipePct(5, 0, layout)).toBe(0)
  })
})
