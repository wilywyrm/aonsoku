import type { RenderUnit } from '@/types/furigana'

// Karaoke wipe math — PURE (no DOM, no layout).
//
// A timing "cue" (one word in the lyrics timing data) is the atomic unit of
// karaoke timing, but it may render as SEVERAL units — a kanji group, its bare
// okurigana, a leading paren, a trailing particle. All units in a cue share ONE
// continuous left-to-right wipe front: there is no sub-cue timing, so the front
// sweeps the cue's characters proportionally to elapsed time and each unit fills
// only as the front crosses its own slice. We model the front in CHARACTER space
// (CJK glyphs are full-width, so char-share ≈ width-share) to avoid per-frame
// pixel measurement. A unit that straddles two contiguous cues fills smoothly as
// the front crosses the cue boundary.

// Minimum cue duration (ms): a zero/negative-duration cue fills instantly rather
// than dividing by zero.
const MIN_DURATION_MS = 1

// Precomputed char layout for one cueLine's ORDERED units. Units and cues tile
// the same character axis in cue order, so both accumulations below share one
// coordinate space: `unitOffset[i]`/`unitWidth[i]` are units[i]'s absolute char
// start and width; `cueStart[j]`/`cueChars[j]` are cue j's absolute char start
// and char count.
export interface WipeLayout {
  unitOffset: number[]
  unitWidth: number[]
  cueStart: number[]
  cueChars: number[]
}

export function computeWipeLayout(
  units: RenderUnit[],
  cueCount: number,
): WipeLayout {
  const cueChars = new Array<number>(cueCount).fill(0)
  for (const u of units) {
    for (let k = 0; k < u.coveringCueIdx.length; k++) {
      const ci = u.coveringCueIdx[k]
      if (ci >= 0 && ci < cueCount) cueChars[ci] += u.cueCharCounts[k]
    }
  }
  const cueStart = new Array<number>(cueCount).fill(0)
  for (let j = 1; j < cueCount; j++) {
    cueStart[j] = cueStart[j - 1] + cueChars[j - 1]
  }

  const unitOffset: number[] = []
  const unitWidth: number[] = []
  let running = 0
  for (const u of units) {
    let width = 0
    for (const c of u.cueCharCounts) width += c
    unitOffset.push(running)
    unitWidth.push(width)
    running += width
  }
  return { unitOffset, unitWidth, cueStart, cueChars }
}

// Absolute char position of the shared wipe front while cue `cueIdx` is active:
// every earlier cue is complete (front past it) plus the active cue's own
// elapsed fraction. Clamped so a just-activated or overrun cue stays in range.
export function wipeFrontChar(
  t: number,
  cueIdx: number,
  cueStartMs: number,
  cueEndMs: number,
  layout: WipeLayout,
): number {
  const start = layout.cueStart[cueIdx] ?? 0
  const chars = layout.cueChars[cueIdx] ?? 0
  const duration = Math.max(MIN_DURATION_MS, cueEndMs - cueStartMs)
  const progress = Math.max(0, Math.min(1, (t - cueStartMs) / duration))
  return start + progress * chars
}

// Fill percentage (0..100) for units[i]: how far the shared front has crossed
// this unit's own char slice.
export function unitWipePct(
  frontChar: number,
  unitIdx: number,
  layout: WipeLayout,
): number {
  const offset = layout.unitOffset[unitIdx] ?? 0
  const width = layout.unitWidth[unitIdx] ?? 0
  if (width <= 0) return 0
  return Math.max(0, Math.min(1, (frontChar - offset) / width)) * 100
}
