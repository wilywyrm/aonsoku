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

  it('peels a trailing space baked into a cue slice into a gap (no fusing)', () => {
    // A spaced reading ('watashi ') slices to include its trailing space; that
    // space must surface as a gap between watashi and otona, not bake into the
    // inline-block token (which trims its own whitespace and would fuse them).
    const main = [cue(141640, 142232, '私 '), cue(142232, 142834, '大人')]
    const romaji = cueLine('watashi otona', [
      cue(141640, 142232, 'watashi ', 0, 7),
      cue(142232, 142834, 'otona', 8, 12),
    ])

    const row = buildRomajiRow(main, romaji)

    expect(render(row)).toBe('watashi otona')
    expect(tokens(row).map((t) => t.text)).toEqual(['watashi', 'otona'])
    expect(row.some((i) => i.kind === 'gap' && i.text === ' ')).toBe(true)
    expect(tokens(row).map((t) => t.mainCueIdx)).toEqual([0, 1])
  })

  it('returns [] when the romaji cueLine is absent or empty', () => {
    expect(buildRomajiRow([cue(0, 1, 'x')], undefined)).toEqual([])
    expect(buildRomajiRow([cue(0, 1, 'x')], cueLine('', []))).toEqual([])
  })

  it('renders untimed particles/okurigana between cues as static gaps (sparse)', () => {
    // あぶく hira line: only 私/蠢く/獣 carry readings; the particle に (bytes
    // 9-11) and okurigana く (bytes 21-23) are untimed and belong to no cue, so
    // they slice out of the line value as static gaps (3 bytes per kana).
    const main = [
      cue(14630, 15053, '私'),
      cue(15472, 16032, '蠢く'),
      cue(16032, 17255, '獣'),
    ]
    const romaji = cueLine('わたしにうごめくけもの', [
      cue(14630, 15053, 'わたし', 0, 8),
      cue(15472, 16032, 'うごめ', 12, 20),
      cue(16032, 17255, 'けもの', 24, 32),
    ])

    const row = buildRomajiRow(main, romaji)

    expect(render(row)).toBe('わたしにうごめくけもの')
    expect(tokens(row).map((t) => t.text)).toEqual([
      'わたし',
      'うごめ',
      'けもの',
    ])
    expect(row.filter((i) => i.kind === 'gap').map((i) => i.text)).toEqual([
      'に',
      'く',
    ])
    expect(tokens(row).map((t) => t.mainCueIdx)).toEqual([0, 1, 2])
  })

  it('slices multi-byte macron vowels by UTF-8 byte offset', () => {
    // ā = 2 bytes (0-1), space (2), dō = d(3) + ō(4-5).
    const main = [cue(11762, 12538, 'あぁ'), cue(12538, 12826, 'どう')]
    const romaji = cueLine('ā dō', [
      cue(11762, 12538, 'ā', 0, 1),
      cue(12538, 12826, 'dō', 3, 5),
    ])

    const row = buildRomajiRow(main, romaji)

    expect(render(row)).toBe('ā dō')
    expect(tokens(row).map((t) => t.text)).toEqual(['ā', 'dō'])
  })

  it('disambiguates repeated readings by byte offset (夕×3 → yū yū yū)', () => {
    const main = [
      cue(195480, 195811, '夕'),
      cue(195811, 196201, '夕'),
      cue(196201, 196541, '夕'),
    ]
    const romaji = cueLine('yū yū yū', [
      cue(195480, 195811, 'yū', 0, 2),
      cue(195811, 196201, 'yū', 4, 6),
      cue(196201, 196541, 'yū', 8, 10),
    ])

    const row = buildRomajiRow(main, romaji)

    expect(render(row)).toBe('yū yū yū')
    expect(tokens(row).map((t) => t.text)).toEqual(['yū', 'yū', 'yū'])
    expect(tokens(row).map((t) => t.mainCueIdx)).toEqual([0, 1, 2])
    expect(tokens(row).map((t) => t.startMs)).toEqual([195480, 195811, 196201])
  })

  it('recovers a byte-offset-less cue from the line value via main-cue linking', () => {
    // The 'b' cue carries timing but no byteStart/byteEnd, so it can't be
    // sliced; its text still lives in the line value and matches the unclaimed
    // main cue 'B', so it is recovered as a linked token rather than dropped.
    const main = [cue(0, 500, 'A'), cue(500, 1000, 'B')]
    const romaji = cueLine('a b', [cue(0, 500, 'a', 0, 0), cue(500, 1000, 'b')])

    const row = buildRomajiRow(main, romaji)

    expect(tokens(row).map((t) => t.text)).toEqual(['a', 'b'])
    expect(tokens(row).map((t) => t.mainCueIdx)).toEqual([0, 1])
  })

  it('links a pass-through English word to its own main cue (no romaji cue)', () => {
    // 'Dreaming' is copied verbatim into the romaji line but carries no romaji
    // cue; it must bind to main cue 1 and inherit that cue's timing.
    const main = [cue(1000, 2000, '夢'), cue(2000, 4000, 'Dreaming')]
    const romaji = cueLine('yume Dreaming', [cue(1000, 2000, 'yume', 0, 3)])

    const row = buildRomajiRow(main, romaji)

    expect(render(row)).toBe('yume Dreaming')
    expect(tokens(row).map((t) => t.text)).toEqual(['yume', 'Dreaming'])
    expect(tokens(row).map((t) => t.mainCueIdx)).toEqual([0, 1])
    const dreaming = tokens(row)[1]
    expect([dreaming.startMs, dreaming.endMs]).toEqual([2000, 4000])
  })

  it('binds repeated pass-through text to SUCCESSIVE main cues, never re-matching the first', () => {
    // Both 'la' are pass-through (no romaji cue). A naive line search would
    // resolve both to the first 'la' (main 1); the forward-only pointer binds
    // them to main 1 and main 3 respectively, with distinct timings.
    const main = [
      cue(1000, 2000, '夢'),
      cue(2000, 3000, 'la'),
      cue(3000, 4000, '見る'),
      cue(4000, 5000, 'la'),
    ]
    const romaji = cueLine('yume la miru la', [
      cue(1000, 2000, 'yume', 0, 3),
      cue(3000, 4000, 'miru', 8, 11),
    ])

    const row = buildRomajiRow(main, romaji)

    expect(render(row)).toBe('yume la miru la')
    expect(tokens(row).map((t) => t.text)).toEqual(['yume', 'la', 'miru', 'la'])
    expect(tokens(row).map((t) => t.mainCueIdx)).toEqual([0, 1, 2, 3])
    const las = tokens(row).filter((t) => t.text === 'la')
    expect(las.map((t) => t.startMs)).toEqual([2000, 4000])
  })

  it('splits a contiguous repeated pass-through gap ("la la") across successive main cues', () => {
    const main = [
      cue(0, 1000, '夢'),
      cue(1000, 2000, 'la'),
      cue(2000, 3000, 'la'),
      cue(3000, 4000, '見る'),
    ]
    const romaji = cueLine('yume la la miru', [
      cue(0, 1000, 'yume', 0, 3),
      cue(3000, 4000, 'miru', 11, 14),
    ])

    const row = buildRomajiRow(main, romaji)

    expect(render(row)).toBe('yume la la miru')
    expect(tokens(row).map((t) => t.text)).toEqual(['yume', 'la', 'la', 'miru'])
    expect(tokens(row).map((t) => t.mainCueIdx)).toEqual([0, 1, 2, 3])
    const las = tokens(row).filter((t) => t.text === 'la')
    expect(las.map((t) => t.startMs)).toEqual([1000, 2000])
  })

  it('splits a multi-word pass-through gap into one token per main cue', () => {
    const main = [
      cue(0, 1000, '夢'),
      cue(1000, 1500, 'I'),
      cue(1500, 2000, 'love'),
      cue(2000, 2500, 'you'),
      cue(2500, 3500, '見る'),
    ]
    const romaji = cueLine('yume I love you miru', [
      cue(0, 1000, 'yume', 0, 3),
      cue(2500, 3500, 'miru', 16, 19),
    ])

    const row = buildRomajiRow(main, romaji)

    expect(render(row)).toBe('yume I love you miru')
    expect(tokens(row).map((t) => t.text)).toEqual([
      'yume',
      'I',
      'love',
      'you',
      'miru',
    ])
    expect(tokens(row).map((t) => t.mainCueIdx)).toEqual([0, 1, 2, 3, 4])
  })

  it('links pass-through text that leads the line (before the first romaji cue)', () => {
    const main = [cue(0, 1000, 'Hello'), cue(1000, 2000, '夢')]
    const romaji = cueLine('Hello yume', [cue(1000, 2000, 'yume', 6, 9)])

    const row = buildRomajiRow(main, romaji)

    expect(render(row)).toBe('Hello yume')
    expect(tokens(row).map((t) => t.text)).toEqual(['Hello', 'yume'])
    expect(tokens(row).map((t) => t.mainCueIdx)).toEqual([0, 1])
  })

  it('leaves an uncovered word that matches no main cue as a static gap', () => {
    // The unclaimed main cue reads 'ah', so the uncovered 'oh' must NOT link —
    // the value guard rejects the near-miss and it degrades to a plain gap.
    const main = [
      cue(0, 1000, '夢'),
      cue(1000, 2000, 'ah'),
      cue(2000, 3000, '空'),
    ]
    const romaji = cueLine('yume oh sora', [
      cue(0, 1000, 'yume', 0, 3),
      cue(2000, 3000, 'sora', 8, 11),
    ])

    const row = buildRomajiRow(main, romaji)

    expect(render(row)).toBe('yume oh sora')
    expect(tokens(row).map((t) => t.text)).toEqual(['yume', 'sora'])
    expect(tokens(row).map((t) => t.mainCueIdx)).toEqual([0, 2])
    expect(row.some((i) => i.kind === 'gap' && i.text.includes('oh'))).toBe(
      true,
    )
  })

  it('links pass-through words the main track split into karaoke syllables', () => {
    // Real line: English words are split into sub-word cues on the main track
    // ('ne'+'ver', 'sur'+'ren'+'der') but appear whole in the romaji line value.
    // Each fragment must still link to its own main cue, in order, so 'never
    // surrender' is not left as an orphaned gap.
    const main = [
      cue(149661, 149776, 'Let '),
      cue(149776, 149888, 'it '),
      cue(149888, 150024, 'be '),
      cue(150024, 150302, 'known '),
      cue(150302, 150444, '消'),
      cue(150444, 150525, 'え'),
      cue(150525, 150664, 'ろ'),
      cue(150664, 151002, 'よ '),
      cue(151002, 151216, 'I '),
      cue(151216, 151357, 'will '),
      cue(151357, 151451, 'ne'),
      cue(151451, 151584, 'ver '),
      cue(151584, 151697, 'sur'),
      cue(151697, 152031, 'ren'),
      cue(152031, 152531, 'der'),
    ]
    const romaji = cueLine('Let it be known kiero yo I will never surrender', [
      cue(150302, 150444, 'ki', 16, 17),
      cue(150444, 150525, 'e', 18, 18),
      cue(150525, 150664, 'ro', 19, 20),
      cue(150664, 151002, 'yo', 22, 23),
    ])

    const row = buildRomajiRow(main, romaji)

    expect(render(row)).toBe('Let it be known kiero yo I will never surrender')
    expect(tokens(row).map((t) => t.text)).toEqual([
      'Let',
      'it',
      'be',
      'known',
      'ki',
      'e',
      'ro',
      'yo',
      'I',
      'will',
      'ne',
      'ver',
      'sur',
      'ren',
      'der',
    ])
    expect(tokens(row).map((t) => t.mainCueIdx)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ])
    // Each 'never'/'surrender' fragment carries its own main-cue timing.
    const ne = tokens(row).find((t) => t.text === 'ne')
    const ver = tokens(row).find((t) => t.text === 'ver')
    expect([ne?.startMs, ver?.startMs]).toEqual([151357, 151451])
  })
})
