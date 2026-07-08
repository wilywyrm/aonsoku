import { describe, expect, it } from 'vitest'
import type { RenderUnit } from '@/types/furigana'
import {
  type CueTiming,
  computeUnitFillPx,
  computeUnitFillPxForUnit,
} from './wipeFront'

describe('computeUnitFillPx', () => {
  describe('single cue (n=1) reduces to clamp((t-s)/(e-s)) * W', () => {
    const cues: CueTiming[] = [{ start: 0, end: 1000 }]
    const widths = [40]

    it('is 0 at/before start', () => {
      expect(computeUnitFillPx(0, cues, widths)).toBeCloseTo(0, 5)
      expect(computeUnitFillPx(-100, cues, widths)).toBeCloseTo(0, 5)
    })

    it('is proportional mid-cue', () => {
      expect(computeUnitFillPx(250, cues, widths)).toBeCloseTo(10, 5)
      expect(computeUnitFillPx(500, cues, widths)).toBeCloseTo(20, 5)
      expect(computeUnitFillPx(750, cues, widths)).toBeCloseTo(30, 5)
    })

    it('clamps to W at/after end', () => {
      expect(computeUnitFillPx(1000, cues, widths)).toBeCloseTo(40, 5)
      expect(computeUnitFillPx(5000, cues, widths)).toBeCloseTo(40, 5)
    })
  })

  describe('two contiguous cues (e0 === s1) are continuous and monotone', () => {
    const cues: CueTiming[] = [
      { start: 0, end: 500 },
      { start: 500, end: 1000 },
    ]
    const widths = [30, 30]

    it('reaches exactly w0 at the boundary t = e0 = s1', () => {
      expect(computeUnitFillPx(500, cues, widths)).toBeCloseTo(30, 5)
    })

    it('fills across the second cue', () => {
      expect(computeUnitFillPx(750, cues, widths)).toBeCloseTo(45, 5)
      expect(computeUnitFillPx(1000, cues, widths)).toBeCloseTo(60, 5)
    })

    it('is monotonically non-decreasing in t', () => {
      const samples = [0, 125, 250, 500, 625, 750, 1000].map((t) =>
        computeUnitFillPx(t, cues, widths),
      )
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1])
      }
    })
  })

  it('pauses across a timing gap between cues', () => {
    const cues: CueTiming[] = [
      { start: 0, end: 500 },
      { start: 1000, end: 1500 },
    ]
    const widths = [20, 20]
    // In the gap (t=750): first cue full, second not started.
    expect(computeUnitFillPx(750, cues, widths)).toBeCloseTo(20, 5)
    expect(computeUnitFillPx(1250, cues, widths)).toBeCloseTo(30, 5)
  })

  it('handles a degenerate (zero-duration) cue without NaN/Infinity', () => {
    const cues: CueTiming[] = [{ start: 100, end: 100 }]
    const widths = [20]
    const atStart = computeUnitFillPx(100, cues, widths)
    const afterStart = computeUnitFillPx(101, cues, widths)
    expect(Number.isFinite(atStart)).toBe(true)
    expect(atStart).toBeCloseTo(0, 5)
    // Any time past the instant fills the whole sub-portion.
    expect(afterStart).toBeCloseTo(20, 5)
  })

  it('returns 0 on a cueTimings/subWidths length mismatch (caller bug)', () => {
    expect(computeUnitFillPx(500, [{ start: 0, end: 1000 }], [30, 30])).toBe(0)
  })
})

describe('computeUnitFillPxForUnit', () => {
  it('selects the unit covering cues by index then delegates', () => {
    const allCueTimings: CueTiming[] = [
      { start: 0, end: 100 },
      { start: 100, end: 600 },
      { start: 600, end: 1100 },
    ]
    const unit: RenderUnit = {
      charStart: 0,
      charEnd: 1,
      kanjiText: '大人',
      kana: 'おとな',
      nonSplittable: true,
      coveringCueIdx: [1, 2],
    }
    const subWidths = [30, 30]
    // At t=600: cue[1] just filled (30), cue[2] not started (0).
    expect(
      computeUnitFillPxForUnit(unit, 600, allCueTimings, subWidths),
    ).toBeCloseTo(30, 5)
    // At t=1100: both filled.
    expect(
      computeUnitFillPxForUnit(unit, 1100, allCueTimings, subWidths),
    ).toBeCloseTo(60, 5)
  })
})
