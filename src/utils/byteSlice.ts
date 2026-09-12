export function byteSlice(
  value: string,
  byteStart: number,
  byteEnd: number,
): string {
  if (!value) return ''
  if (byteStart > byteEnd) {
    if (import.meta.env.DEV)
      console.warn('[byteSlice] byteStart > byteEnd', { byteStart, byteEnd })
    return ''
  }
  const encoded = new TextEncoder().encode(value)
  const start = Math.max(0, byteStart)
  const end = Math.min(encoded.length - 1, byteEnd)
  if (start > encoded.length - 1) return ''
  return new TextDecoder('utf-8', { fatal: false }).decode(
    encoded.slice(start, end + 1),
  )
}

export function byteSliceFallback(
  cue: { value?: string; byteStart?: number; byteEnd?: number },
  lineValue: string,
): string {
  if (cue.byteStart !== undefined && cue.byteEnd !== undefined) {
    return byteSlice(lineValue, cue.byteStart, cue.byteEnd)
  }
  return cue.value ?? ''
}

export interface MainCueGaps {
  /** Uncovered `lineValue` text to render before the cue at each index; `''` if none. */
  leads: string[]
  /** Uncovered `lineValue` text after the last cue; `''` if none. */
  tail: string
}

/**
 * Runs of `lineValue` that no cue's inclusive [byteStart, byteEnd] range covers
 * (word spacing, untimed punctuation). The word-level view paints one span per
 * cue slice, so these fillers are what keep inter-word spaces from vanishing.
 * Returns all-empty unless every cue carries byte offsets — otherwise the byte
 * layout is ambiguous and the caller keeps its `cue.value` concatenation.
 */
export function buildMainCueGaps(
  cues: ReadonlyArray<{ byteStart?: number; byteEnd?: number }>,
  lineValue: string,
): MainCueGaps {
  const leads: string[] = Array.from({ length: cues.length }, () => '')
  const allHaveByteOffsets =
    cues.length > 0 &&
    cues.every((c) => c.byteStart !== undefined && c.byteEnd !== undefined)
  if (!lineValue || !allHaveByteOffsets) return { leads, tail: '' }

  const byteLength = new TextEncoder().encode(lineValue).length
  let cursor = 0
  for (let i = 0; i < cues.length; i++) {
    const { byteStart, byteEnd } = cues[i]
    if (byteStart === undefined || byteEnd === undefined) continue
    if (byteStart > cursor) {
      leads[i] = byteSlice(lineValue, cursor, byteStart - 1)
    }
    cursor = Math.max(cursor, byteEnd + 1)
  }

  const tail =
    cursor <= byteLength - 1 ? byteSlice(lineValue, cursor, byteLength - 1) : ''
  return { leads, tail }
}
