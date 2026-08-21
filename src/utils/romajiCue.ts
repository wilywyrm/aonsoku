import { byteSlice, byteSliceFallback } from './byteSlice'
import type { NormalizedCue, NormalizedCueLine } from './wordTiming'

/**
 * One interactive romaji word span. It renders the romaji cue's own text and is
 * wired to the MAIN cue it corresponds to (`mainCueIdx`) so its karaoke wipe,
 * past/active/future state, hover, and focus enlargement/centering ride in
 * lockstep with the main lyric — never on the romaji's own (possibly mora-split)
 * spacing. Seek/wipe use the romaji cue's own offset-applied timing, which
 * equals the main cue's timing in the 1:1 tracks the authoring tool emits.
 */
export interface RomajiToken {
  kind: 'token'
  text: string
  /** Index into the MAIN cueLine's cues that this token aligns to (by start ts). */
  mainCueIdx: number
  /** Romaji cue start (ms, offset applied) — click-to-seek + wipe reference. */
  startMs: number
  /** Romaji cue end (ms, offset applied). */
  endMs: number
}

/**
 * Static, non-interactive characters between two tokens (spaces / punctuation),
 * taken VERBATIM from the romaji line value so the author's own spacing is
 * preserved exactly (see {@link buildRomajiRow}).
 */
export interface RomajiGap {
  kind: 'gap'
  text: string
}

export type RomajiItem = RomajiToken | RomajiGap

/**
 * Index of the main cue whose [start, end) contains `t`; falls back to the main
 * cue with the nearest start when `t` lands in a gap. Returns -1 only when there
 * are no main cues (caller then drops the token).
 */
function mainCueIndexForStart(mainCues: NormalizedCue[], t: number): number {
  if (mainCues.length === 0) return -1
  let best = -1
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < mainCues.length; i++) {
    const c = mainCues[i]
    if (t >= c.start && t < c.end) return i
    const d = Math.abs(c.start - t)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/**
 * Build the ordered romaji render row for one MAIN cueLine by overlaying the
 * romaji (Latn) cueLine's own cues, matched to the main cues by START timestamp.
 *
 * Spacing is taken VERBATIM from the romaji line value — the characters BETWEEN
 * two consecutive romaji cues (their byte gap) are emitted as a static
 * {@link RomajiGap}. So a word-spaced romaji line (`"kyō wa tenki ga ii"`) keeps
 * its spaces, a solid one (`"kokoro"`) concatenates, and a mora-split one
 * (`"ko n ni chi wa"`) renders as-authored. No collapsing, no inserting, no
 * segmenter — the romaji's spaces ARE the word boundaries (the authoring tool
 * space-joins per-token, so nothing better is recoverable for pure kana).
 *
 * Whitespace-only cues (e.g. the explicit `value:" "` space cues some providers
 * emit) degrade to gaps so they never become hover/seek targets.
 *
 * Returns `[]` when the romaji cueLine is absent or carries no cues, so the
 * caller cleanly falls back to the static line-level romaji.
 */
export function buildRomajiRow(
  mainCues: NormalizedCue[],
  romajiCueLine: NormalizedCueLine | undefined,
): RomajiItem[] {
  if (!romajiCueLine || romajiCueLine.cues.length === 0) return []

  const value = romajiCueLine.value
  const items: RomajiItem[] = []
  let prevByteEnd: number | undefined

  for (const cue of romajiCueLine.cues) {
    const text = byteSliceFallback(cue, value)

    // Whitespace-only cue → static gap, never an interactive token.
    if (text.trim() === '') {
      if (text) items.push({ kind: 'gap', text })
      if (cue.byteEnd !== undefined) prevByteEnd = cue.byteEnd
      continue
    }

    // Verbatim gap between the previous cue and this one.
    if (
      prevByteEnd !== undefined &&
      cue.byteStart !== undefined &&
      cue.byteStart > prevByteEnd + 1
    ) {
      const gap = byteSlice(value, prevByteEnd + 1, cue.byteStart - 1)
      if (gap) items.push({ kind: 'gap', text: gap })
    } else if (
      prevByteEnd !== undefined &&
      (cue.byteStart === undefined || prevByteEnd === undefined)
    ) {
      // No byte offsets to derive spacing from → default to one space so
      // adjacent words don't fuse (matches Hepburn word spacing).
      items.push({ kind: 'gap', text: ' ' })
    }

    items.push({
      kind: 'token',
      text,
      mainCueIdx: mainCueIndexForStart(mainCues, cue.start),
      startMs: cue.start,
      endMs: cue.end,
    })
    prevByteEnd = cue.byteEnd
  }

  return items
}
