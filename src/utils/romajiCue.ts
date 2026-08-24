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
 * romaji (Latn) cueLine's own cues, matched to the main cues by START timestamp.
 *
 * Token text comes from each cue's `value` (e.g. "hitai", "ni"), NOT from the
 * cue's byte offsets: the authoring pipeline emits per-word-LOCAL byteStart/
 * byteEnd on pronunciation cues (0-based within each word), so byte-slicing the
 * line value with them shreds it into repeated fragments. Verbatim spacing is
 * instead recovered by locating each word in the line `value` left-to-right —
 * the line value is the tool's own space-join of the words, so this reproduces
 * the author's spacing exactly (word-spaced "kyō wa", solid "kokoro", or
 * mora-split "ko n ni chi wa") while being immune to the bogus offsets. When a
 * word cannot be located (missing/garbled line value) we fall back to a single
 * separating space so adjacent words never fuse.
 *
 * Whitespace-only cues degrade to gaps so they never become hover/seek targets.
 *
 * Returns `[]` when the romaji cueLine is absent or carries no cues, so the
 * caller cleanly falls back to the static line-level romaji.
 */
export function buildRomajiRow(
  mainCues: NormalizedCue[],
  romajiCueLine: NormalizedCueLine | undefined,
): RomajiItem[] {
  if (!romajiCueLine || romajiCueLine.cues.length === 0) return []

  const value = romajiCueLine.value ?? ''
  const items: RomajiItem[] = []
  let cursor = 0
  let emittedToken = false

  for (const cue of romajiCueLine.cues) {
    const cueText = cue.value ?? ''
    if (cueText === '') continue

    // Whitespace-only cue → static gap, never an interactive token.
    if (cueText.trim() === '') {
      items.push({ kind: 'gap', text: cueText })
      if (value.startsWith(cueText, cursor)) cursor += cueText.length
      continue
    }

    // Match (and render) the trimmed word: a cue value that carries a word-
    // separator space (e.g. "watashi " from a spaced reading) must surface that
    // space as a gap, not bake it into the token — an inline-block `.romaji-word`
    // trims its own trailing/leading whitespace, which would fuse it to the next.
    const word = cueText.trim()
    const at = value.indexOf(word, cursor)
    if (at >= 0) {
      if (at > cursor) {
        const gap = value.slice(cursor, at)
        if (gap) items.push({ kind: 'gap', text: gap })
      }
      cursor = at + word.length
    } else if (emittedToken) {
      items.push({ kind: 'gap', text: ' ' })
    }

    items.push({
      kind: 'token',
      text: word,
      mainCueIdx: mainCueIndexForStart(mainCues, cue.start),
      startMs: cue.start,
      endMs: cue.end,
    })
    emittedToken = true
  }

  return items
}
