import { describe, expect, it } from 'vitest'
import { buildRomajiRow, type RomajiItem } from './romajiCue'
import type { NormalizedCue, NormalizedCueLine } from './wordTiming'

function cue(
  start: number,
  end: number,
  value: string,
  byteStart?: number,
  byteEnd?: number,
): NormalizedCue {
  return { start, end, value, byteStart, byteEnd }
}

function cueLine(value: string, cues: NormalizedCue[]): NormalizedCueLine {
  return {
    lineIndex: 0,
    key: '0:lead',
    displayOrder: 0,
    start: cues[0]?.start ?? 0,
    end: cues[cues.length - 1]?.end ?? 0,
    value,
    cues,
  }
}

/** Reconstruct the rendered string from a row (tokens + gaps, in order). */
function render(items: RomajiItem[]): string {
  return items.map((i) => i.text).join('')
}

/** Just the interactive tokens. */
function tokens(items: RomajiItem[]) {
  return items.filter(
    (i): i is Extract<RomajiItem, { kind: 'token' }> => i.kind === 'token',
  )
}

describe('buildRomajiRow', () => {
  it('keeps word spaces and maps each token to its main cue (kanji line)', () => {
    // ASCII romaji so byte offsets == char offsets (macrons work identically
    // in production because the server ships accurate UTF-8 byte offsets).
    const main = [
      cue(1000, 2000, '今日'),
      cue(2000, 2500, 'は'),
      cue(2500, 3500, '天気'),
      cue(3500, 4000, 'が'),
      cue(4000, 5000, 'いい'),
    ]
    const romaji = cueLine('kyo wa tenki ga ii', [
      cue(1000, 2000, 'kyo', 0, 2),
      cue(2000, 2500, 'wa', 4, 5),
      cue(2500, 3500, 'tenki', 7, 11),
      cue(3500, 4000, 'ga', 13, 14),
      cue(4000, 5000, 'ii', 16, 17),
    ])

    const row = buildRomajiRow(main, romaji)

    expect(render(row)).toBe('kyo wa tenki ga ii')
    expect(tokens(row).map((t) => t.text)).toEqual([
      'kyo',
      'wa',
      'tenki',
      'ga',
      'ii',
    ])
    // 1:1 correspondence to main cues.
    expect(tokens(row).map((t) => t.mainCueIdx)).toEqual([0, 1, 2, 3, 4])
    // Seek/wipe reference is the romaji cue's own (offset-applied) start.
    expect(tokens(row)[1].startMs).toBe(2000)
  })

  it('accepts mora-split spacing verbatim (pure kana → "ko n ni chi wa")', () => {
    const main = [
      cue(0, 200, 'こ'),
      cue(200, 400, 'ん'),
      cue(400, 600, 'に'),
      cue(600, 800, 'ち'),
      cue(800, 1000, 'は'),
    ]
    const romaji = cueLine('ko n ni chi wa', [
      cue(0, 200, 'ko', 0, 1),
      cue(200, 400, 'n', 3, 3),
      cue(400, 600, 'ni', 5, 6),
      cue(600, 800, 'chi', 8, 10),
      cue(800, 1000, 'wa', 12, 13),
    ])

    const row = buildRomajiRow(main, romaji)

    // Pinned: we do NOT "fix" this to "konnichiwa" — the boundary is unrecoverable.
    expect(render(row)).toBe('ko n ni chi wa')
    expect(tokens(row).map((t) => t.mainCueIdx)).toEqual([0, 1, 2, 3, 4])
  })

  it('concatenates a solid romaji word with no gap chars (kanji-anchored)', () => {
    const main = [cue(0, 600, '心')]
    const romaji = cueLine('kokoro', [
      cue(0, 200, 'ko', 0, 1),
      cue(200, 400, 'ko', 2, 3),
      cue(400, 600, 'ro', 4, 5),
    ])

    const row = buildRomajiRow(main, romaji)

    expect(render(row)).toBe('kokoro')
    // All three sub-cues belong to the single main cue.
    expect(tokens(row).map((t) => t.mainCueIdx)).toEqual([0, 0, 0])
    // No gap items were emitted.
    expect(row.every((i) => i.kind === 'token')).toBe(true)
  })

  it('treats explicit whitespace-only cues as static gaps, not tokens', () => {
    const main = [cue(0, 550, 'Echo'), cue(600, 1000, 'in')]
    const romaji = cueLine('Echo in', [
      cue(0, 500, 'Echo', 0, 3),
      cue(500, 600, ' ', 4, 4),
      cue(600, 1000, 'in', 5, 6),
    ])

    const row = buildRomajiRow(main, romaji)

    expect(render(row)).toBe('Echo in')
    expect(tokens(row).map((t) => t.text)).toEqual(['Echo', 'in'])
    expect(tokens(row).map((t) => t.mainCueIdx)).toEqual([0, 1])
  })

  it('returns [] when the romaji cueLine is absent or empty', () => {
    expect(buildRomajiRow([cue(0, 1, 'x')], undefined)).toEqual([])
    expect(buildRomajiRow([cue(0, 1, 'x')], cueLine('', []))).toEqual([])
  })
})
