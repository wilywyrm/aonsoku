import type { RenderUnit } from '@/types/furigana'

// Karaoke wipe-front math for a single render unit — PURE (no DOM, no layout).
//
// A render unit (one kanji group plus its ruby) is usually covered by a single
// timing cue, but a straddling jukujikun reads as one unit while spanning two
// cues. The wipe fill must then advance as ONE shared front summed over every
// covering cue — not as an independent percentage per cue — so the fill stays
// monotone and continuous across a contiguous boundary (eᵢ === sᵢ₊₁).
//
// The caller measures the pixel sub-width of the unit inside each covering cue
// (Task 14) and passes them in as `subWidths`; this module only does the timing
// arithmetic. Task 15 writes the returned pixel value to the overlay `--fill`.

// One covering cue's [start, end] window, in milliseconds.
export interface CueTiming {
  start: number
  end: number
}

// Minimum cue duration in ms. Mirrors the existing `Math.max(1, cue.end -
// cue.start)` guard in word-level-lyrics/container.tsx: a degenerate or
// zero-duration cue (end <= start) then fills its sub-portion effectively
// instantly instead of dividing by zero and yielding NaN/Infinity.
const MIN_DURATION_MS = 1

// Pixel wipe-front for one unit at time `t`, summed over the cues covering it:
//
//   front(t) = Σᵢ subWidths[i] · clamp((t − sᵢ) / max(ε, eᵢ − sᵢ), 0, 1)
//
// where `subWidths[i]` is the px width of the unit's slice inside
// `cueTimings[i]`, ε = MIN_DURATION_MS, and W = Σ subWidths. The sum is
// order-independent, continuous at contiguous boundaries, pauses across gaps,
// and always lands within [0, W]. For a single cue (n === 1) it reduces exactly
// to clamp((t − s) / (e − s), 0, 1) · W — today's `.karaoke-fill` percentage
// (container.tsx) expressed in pixels.
//
// Defensive: `cueTimings` and `subWidths` must be paired 1:1, so a length
// mismatch is a caller bug — return 0 rather than read past an array.
export function computeUnitFillPx(
  t: number,
  cueTimings: CueTiming[],
  subWidths: number[],
): number {
  if (cueTimings.length !== subWidths.length) return 0

  let front = 0
  let total = 0
  for (let i = 0; i < cueTimings.length; i++) {
    const { start, end } = cueTimings[i]
    const width = subWidths[i]
    total += width
    const duration = Math.max(MIN_DURATION_MS, end - start)
    front += width * Math.max(0, Math.min(1, (t - start) / duration))
  }
  return Math.max(0, Math.min(total, front))
}

// Thin adapter: select a unit's covering-cue timings out of the line's full cue
// list (`allCueTimings`, indexed by global cue index) via `unit.coveringCueIdx`,
// then delegate to `computeUnitFillPx`. `subWidths` must be paired 1:1 with
// `unit.coveringCueIdx` (same order, same length). Kept intentionally trivial —
// `computeUnitFillPx` is the tested unit.
export function computeUnitFillPxForUnit(
  unit: RenderUnit,
  t: number,
  allCueTimings: CueTiming[],
  subWidths: number[],
): number {
  const timings = unit.coveringCueIdx.map((idx) => allCueTimings[idx])
  return computeUnitFillPx(t, timings, subWidths)
}
