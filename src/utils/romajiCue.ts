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
 * Push a static byte-range slice, promoting any pass-through word(s) it carries
 * into MAIN-linked karaoke tokens.
 *
 * Pass-through text is content copied verbatim into the romaji line value but
 * left without its own timed romaji cue (e.g. an English word inside a Japanese
 * line). The MAIN track still times it, so we bind each such word to the MAIN
 * cue no covered romaji cue claimed — it then rides that cue's karaoke wipe and
 * past/active/future state instead of dying as an inert `gap`.
 *
 * Matching is by READING ORDER, never by scanning the whole line: a forward-only
 * pointer (`ptr`, seeded past `lo`) plus the shared `claimed` set guarantee a
 * repeated token ("la … la", "Dreaming … Dreaming") consumes the NEXT unclaimed
 * MAIN cue rather than re-finding the first occurrence. `hi` caps candidates to
 * the MAIN cues preceding the following covered token, so a lead gap can never
 * reach past its neighbour. A word links only when it matches its candidate MAIN
 * cue's value verbatim (case-insensitive, at a trailing word boundary): romaji
 * readings differ from their kanji/kana MAIN value and so never link, only
 * genuine pass-through does. Whitespace is preserved as `gap`s and any unmatched
 * remainder stays a single `gap` (safe degradation to the prior behaviour).
 *
 * Mutates `items` (appends) and `claimed` (marks consumed indices); returns the
 * advanced `lo` (highest MAIN index bound so far).
 */
function pushLinkedGap(
  items: RomajiItem[],
  text: string,
  lo: number,
  mainCues: NormalizedCue[],
  claimed: Set<number>,
  hi: number = mainCues.length,
): number {
  if (!text) return lo

  let cursor = 0
  let ptr = lo + 1

  while (cursor < text.length) {
    // Advance to the next MAIN cue no covered romaji cue already claimed.
    while (ptr < hi && claimed.has(ptr)) ptr++
    if (ptr >= hi) break

    const target = (mainCues[ptr]?.value ?? '').trim()
    const rest = text.slice(cursor)
    const leadWsLen = rest.length - rest.trimStart().length
    const afterWs = rest.slice(leadWsLen)

    // Whole-token, boundary-checked, case-insensitive prefix match. Case-fold
    // lets a romanizer that re-cases a pass-through token ("YOU" → "you") still
    // link; the trailing-boundary guard stops a short value ("la") from biting
    // into a longer word ("lala" / "Introduction").
    const fits =
      target !== '' &&
      afterWs.length >= target.length &&
      afterWs.slice(0, target.length).toLowerCase() === target.toLowerCase() &&
      (afterWs.length === target.length || afterWs[target.length].trim() === '')

    if (!fits) break

    if (leadWsLen > 0) {
      items.push({ kind: 'gap', text: rest.slice(0, leadWsLen) })
    }
    items.push({
      kind: 'token',
      text: afterWs.slice(0, target.length),
      mainCueIdx: ptr,
      startMs: mainCues[ptr].start,
      endMs: mainCues[ptr].end,
    })
    claimed.add(ptr)
    lo = ptr
    cursor += leadWsLen + target.length
    ptr++
  }

  if (cursor < text.length)
    items.push({ kind: 'gap', text: text.slice(cursor) })

  return lo
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
 * Pass-through text (an English word copied verbatim into the romaji line but
 * left without its own timed cue) is the exception: when an uncovered range
 * matches — in reading order — a MAIN cue that no covered romaji cue claimed, it
 * is promoted to a real token bound to that MAIN cue (see {@link pushLinkedGap}),
 * so the orphaned word gets the karaoke wipe + hover link instead of a dead gap.
 * A forward-only pointer keeps repeated pass-through tokens ("la … la") bound to
 * SUCCESSIVE MAIN cues rather than re-matching the first.
 *
 * Whitespace baked into a cue's own slice (a spaced reading like "watashi ") is
 * peeled off as gaps so the inline-block token, which trims its own whitespace,
 * never fuses to a neighbor; a whitespace-only cue degrades to a single gap.
 *
 * Cues are assumed to carry valid cumulative offsets (byteStart ≤ byteEnd,
 * non-overlapping) as emitted by the server; a cue missing offsets is skipped
 * for slicing, but its text still survives in the line value and may be
 * recovered by the pass-through linking above. Returns `[]` when the romaji
 * cueLine is absent or empty, so the caller falls back to the static line-level
 * romaji.
 */
export function buildRomajiRow(
  mainCues: NormalizedCue[],
  romajiCueLine: NormalizedCueLine | undefined,
): RomajiItem[] {
  if (!romajiCueLine || romajiCueLine.cues.length === 0) return []

  const value = romajiCueLine.value ?? ''
  if (value === '') return []
  const byteLength = new TextEncoder().encode(value).length

  // MAIN cue indices bound to a COVERED romaji cue (matched by start ts).
  // Uncovered pass-through text may only claim indices NOT in this set, and
  // pushLinkedGap consumes each at most once, so a repeated token binds to
  // successive MAIN cues instead of re-matching the first.
  const claimed = new Set<number>()
  for (const cue of romajiCueLine.cues) {
    if (cue.byteStart == null || cue.byteEnd == null) continue
    if (byteSlice(value, cue.byteStart, cue.byteEnd).trim() === '') continue
    claimed.add(mainCueIndexForStart(mainCues, cue.start))
  }

  const items: RomajiItem[] = []
  let byteCursor = 0
  // Highest MAIN index bound so far; the next uncovered range may only claim
  // indices strictly greater than this, so the pointer never rewinds.
  let lo = -1

  for (const cue of romajiCueLine.cues) {
    if (cue.byteStart == null || cue.byteEnd == null) continue

    const leadRaw = byteSlice(value, byteCursor, cue.byteStart - 1)
    byteCursor = Math.max(byteCursor, cue.byteEnd + 1)

    const raw = byteSlice(value, cue.byteStart, cue.byteEnd)
    const word = raw.trim()
    const thisMainIdx = mainCueIndexForStart(mainCues, cue.start)

    // The lead range sits BEFORE this token, so cap pass-through candidates at
    // this token's MAIN index — a lead gap can't borrow a cue past its owner.
    lo = pushLinkedGap(items, leadRaw, lo, mainCues, claimed, thisMainIdx)

    if (word === '') {
      // Whitespace-only cue: no token, keep the slice verbatim as a gap.
      if (raw) items.push({ kind: 'gap', text: raw })
      continue
    }

    const leadWs = raw.slice(0, raw.length - raw.trimStart().length)
    const trailWs = raw.slice(raw.trimEnd().length)
    if (leadWs) items.push({ kind: 'gap', text: leadWs })
    items.push({
      kind: 'token',
      text: word,
      mainCueIdx: thisMainIdx,
      startMs: cue.start,
      endMs: cue.end,
    })
    if (trailWs) items.push({ kind: 'gap', text: trailWs })
    lo = Math.max(lo, thisMainIdx)
  }

  const tail = byteSlice(value, byteCursor, byteLength - 1)
  pushLinkedGap(items, tail, lo, mainCues, claimed)

  return items
}
