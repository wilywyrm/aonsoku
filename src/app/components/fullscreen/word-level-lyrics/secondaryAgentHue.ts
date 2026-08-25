/*
 * Per-vocal karaoke wipe colours.
 *
 * The wipe gradient is always painted in the theme's `--primary` colour; a
 * per-vocal `hue-rotate` filter shifts that primary into a distinct hue so each
 * concurrent voice reads as its own colour. displayOrder 0 is the main vocal
 * (no rotation — plain primary); ≥1 are secondary vocals that cycle through
 * these rotations. Furigana (ruby) and transliteration (romaji) share their
 * parent cueLine's displayOrder, so a voice's wipe colour stays consistent
 * across every track it drives.
 */
export const SECONDARY_AGENT_HUE_ROTATIONS = [
  180, 90, 270, 45, 135, 225, 315,
] as const

/**
 * Hue-rotation (deg) for a cueLine's karaoke wipe, or `undefined` for the main
 * vocal (displayOrder 0) which keeps the unshifted primary colour. Callers
 * still gate on the active/wipe state — this only maps displayOrder → hue.
 */
export function secondaryAgentHueRotation(
  displayOrder: number,
): number | undefined {
  if (displayOrder < 1) return undefined
  return SECONDARY_AGENT_HUE_ROTATIONS[
    (displayOrder - 1) % SECONDARY_AGENT_HUE_ROTATIONS.length
  ]
}
