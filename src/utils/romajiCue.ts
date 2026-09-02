import { byteSlice } from './byteSlice'
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
 * Identifies one cue for cross-track hover linking: hovering the main word, its
 * ruby, or its romaji lights up all three. Defined here (a leaf util) so the
 * view and both cue-content components can share it without an import cycle.
 */
export interface LinkedCue {
  lineIdx: number
  cueLineKey: string
  cueIdx: number
}

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
 * romaji (Latn) cueLine's own cues, matched to the MAIN cues by START timestamp.
 *
 * Each cue's text is sliced from `cueLine.value` by its inclusive UTF-8
 * `byteStart`/`byteEnd` (via {@link byteSlice}), so repeated readings and
 * multi-byte vowels resolve unambiguously. Byte ranges no cue covers — untimed
 * particles, okurigana, and word spacing — are emitted as static `gap` items,
 * reproducing the author's spacing (word-spaced "kyō wa", solid "kokoro",
 * mora-split "ko n ni chi wa") straight from the line value.
 *
 * Whitespace baked into a cue's own slice (a spaced reading like "watashi ") is
 * peeled off as gaps so the inline-block token, which trims its own whitespace,
 * never fuses to a neighbor; a whitespace-only cue degrades to a single gap.
 *
 * Cues are assumed to carry valid cumulative offsets (byteStart ≤ byteEnd,
 * non-overlapping) as emitted by the server; a cue missing offsets is skipped.
 * Returns `[]` when the romaji cueLine is absent or empty, so the caller falls
 * back to the static line-level romaji.
 */
export function buildRomajiRow(
  mainCues: NormalizedCue[],
  romajiCueLine: NormalizedCueLine | undefined,
): RomajiItem[] {
  if (!romajiCueLine || romajiCueLine.cues.length === 0) return []

  const value = romajiCueLine.value ?? ''
  if (value === '') return []
  const byteLength = new TextEncoder().encode(value).length

  const items: RomajiItem[] = []
  let byteCursor = 0

  for (const cue of romajiCueLine.cues) {
    if (cue.byteStart == null || cue.byteEnd == null) continue

    const lead = byteSlice(value, byteCursor, cue.byteStart - 1)
    if (lead) items.push({ kind: 'gap', text: lead })
    byteCursor = Math.max(byteCursor, cue.byteEnd + 1)

    const raw = byteSlice(value, cue.byteStart, cue.byteEnd)
    const word = raw.trim()
    if (word === '') {
      if (raw) items.push({ kind: 'gap', text: raw })
      continue
    }

    const leadWs = raw.slice(0, raw.length - raw.trimStart().length)
    const trailWs = raw.slice(raw.trimEnd().length)
    if (leadWs) items.push({ kind: 'gap', text: leadWs })
    items.push({
      kind: 'token',
      text: word,
      mainCueIdx: mainCueIndexForStart(mainCues, cue.start),
      startMs: cue.start,
      endMs: cue.end,
    })
    if (trailWs) items.push({ kind: 'gap', text: trailWs })
  }

  const tail = byteSlice(value, byteCursor, byteLength - 1)
  if (tail) items.push({ kind: 'gap', text: tail })

  return items
}
