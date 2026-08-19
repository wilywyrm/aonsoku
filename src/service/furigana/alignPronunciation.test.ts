import { describe, expect, it } from 'vitest'
import type {
  NormalizedCue,
  NormalizedStructuredLyric,
} from '@/utils/wordTiming'
import { alignPronunciation } from './alignPronunciation'

// Build a minimal NormalizedStructuredLyric from bare lines/cues. Each cue's
// `end` is derived (next cue's start, else start + 500ms) so every cue has a
// positive span, matching normalizeStructuredLyric's all-or-none rule closely
// enough for the timestamp-based cross-track matching under test.
function makeTrack(
  lines: Array<{
    value: string
    cues: Array<{
      start: number
      value: string
      byteStart: number
      byteEnd: number
    }>
  }>,
): NormalizedStructuredLyric {
  return {
    kind: 'main',
    synced: true,
    agents: [],
    hasWordTiming: true,
    breaks: [],
    lines: lines.map((line, lineIndex) => {
      const cues: NormalizedCue[] = line.cues.map((c, ci) => ({
        start: c.start,
        end: line.cues[ci + 1]?.start ?? c.start + 500,
        value: c.value,
        byteStart: c.byteStart,
        byteEnd: c.byteEnd,
      }))
      const start = cues[0]?.start ?? 0
      const end = cues[cues.length - 1]?.end ?? start
      return {
        start,
        end,
        value: line.value,
        cueLines: [
          {
            lineIndex,
            key: `${lineIndex}:pos0`,
            displayOrder: 0,
            start,
            end,
            value: line.value,
            cues,
          },
        ],
      }
    }),
  }
}

describe('alignPronunciation', () => {
  it('食べる/たべる → ruby た over 食 only (べる bare)', () => {
    const main = makeTrack([
      { value: '食べる', cues: [{ start: 0, value: '食べる', byteStart: 0, byteEnd: 8 }] },
    ])
    const pron = makeTrack([
      { value: 'たべる', cues: [{ start: 0, value: 'たべる', byteStart: 0, byteEnd: 8 }] },
    ])

    const result = alignPronunciation(main, pron)

    expect(result[0].segments).toHaveLength(1)
    expect(result[0].segments[0].kana).toBe('た')
    // charStart/charEnd covers only 食 (char 0); べる is left bare.
    expect(result[0].segments[0].charStart).toBe(0)
    expect(result[0].segments[0].charEnd).toBe(0)
    expect(result[0].segments[0].nonSplittable).toBe(false)
  })

  it('焦っ/じれ → ruby じれ over 焦 only (trailing っ bare)', () => {
    const main = makeTrack([
      { value: '焦っ', cues: [{ start: 0, value: '焦っ', byteStart: 0, byteEnd: 5 }] },
    ])
    const pron = makeTrack([
      { value: 'じれ', cues: [{ start: 0, value: 'じれ', byteStart: 0, byteEnd: 5 }] },
    ])

    const result = alignPronunciation(main, pron)

    expect(result[0].segments).toHaveLength(1)
    expect(result[0].segments[0].kana).toBe('じれ')
    // charStart/charEnd covers only 焦 (char 0); the trailing っ is left bare.
    expect(result[0].segments[0].charStart).toBe(0)
    expect(result[0].segments[0].charEnd).toBe(0)
    expect(result[0].segments[0].nonSplittable).toBe(false)
  })

  it('今日/きょう → group ruby (nonSplittable)', () => {
    const main = makeTrack([
      { value: '今日', cues: [{ start: 0, value: '今日', byteStart: 0, byteEnd: 5 }] },
    ])
    const pron = makeTrack([
      { value: 'きょう', cues: [{ start: 0, value: 'きょう', byteStart: 0, byteEnd: 8 }] },
    ])

    const result = alignPronunciation(main, pron)

    expect(result[0].segments).toHaveLength(1)
    expect(result[0].segments[0].kana).toBe('きょう')
    expect(result[0].segments[0].charStart).toBe(0)
    expect(result[0].segments[0].charEnd).toBe(1)
    expect(result[0].segments[0].nonSplittable).toBe(true)
  })

  it('は/は → NO ruby (pure kana passthrough)', () => {
    const main = makeTrack([
      { value: 'は', cues: [{ start: 0, value: 'は', byteStart: 0, byteEnd: 2 }] },
    ])
    const pron = makeTrack([
      { value: 'は', cues: [{ start: 0, value: 'は', byteStart: 0, byteEnd: 2 }] },
    ])

    const result = alignPronunciation(main, pron)

    expect(result[0].segments).toHaveLength(0)
  })

  it('コーヒー/コーヒー → no ruby (katakana passthrough)', () => {
    const main = makeTrack([
      {
        value: 'コーヒー',
        cues: [{ start: 0, value: 'コーヒー', byteStart: 0, byteEnd: 11 }],
      },
    ])
    const pron = makeTrack([
      {
        value: 'コーヒー',
        cues: [{ start: 0, value: 'コーヒー', byteStart: 0, byteEnd: 11 }],
      },
    ])

    const result = alignPronunciation(main, pron)

    expect(result[0].segments).toHaveLength(0)
  })

  it('A/エー → whole-base ruby エー (Latin base, reading as-authored)', () => {
    const main = makeTrack([
      { value: 'A', cues: [{ start: 0, value: 'A', byteStart: 0, byteEnd: 0 }] },
    ])
    const pron = makeTrack([
      { value: 'エー', cues: [{ start: 0, value: 'エー', byteStart: 0, byteEnd: 5 }] },
    ])

    const result = alignPronunciation(main, pron)

    expect(result[0].segments).toHaveLength(1)
    expect(result[0].segments[0].kana).toBe('エー')
    expect(result[0].segments[0].charStart).toBe(0)
    expect(result[0].segments[0].charEnd).toBe(0)
    expect(result[0].segments[0].nonSplittable).toBe(true)
  })

  it('コーヒー/こーひー → whole-base ruby (katakana base, reading differs)', () => {
    const main = makeTrack([
      {
        value: 'コーヒー',
        cues: [{ start: 0, value: 'コーヒー', byteStart: 0, byteEnd: 11 }],
      },
    ])
    const pron = makeTrack([
      {
        value: 'こーひー',
        cues: [{ start: 0, value: 'こーひー', byteStart: 0, byteEnd: 11 }],
      },
    ])

    const result = alignPronunciation(main, pron)

    expect(result[0].segments).toHaveLength(1)
    expect(result[0].segments[0].kana).toBe('こーひー')
    expect(result[0].segments[0].charStart).toBe(0)
    expect(result[0].segments[0].charEnd).toBe(3)
    expect(result[0].segments[0].nonSplittable).toBe(true)
  })

  it('お茶/おちゃ → ruby ちゃ over 茶 only (お bare, leading kana stripped)', () => {
    const main = makeTrack([
      { value: 'お茶', cues: [{ start: 0, value: 'お茶', byteStart: 0, byteEnd: 5 }] },
    ])
    const pron = makeTrack([
      { value: 'おちゃ', cues: [{ start: 0, value: 'おちゃ', byteStart: 0, byteEnd: 8 }] },
    ])

    const result = alignPronunciation(main, pron)

    expect(result[0].segments).toHaveLength(1)
    expect(result[0].segments[0].kana).toBe('ちゃ')
    expect(result[0].segments[0].charStart).toBe(1)
    expect(result[0].segments[0].charEnd).toBe(1)
    expect(result[0].segments[0].nonSplittable).toBe(false)
  })

  it('spans several main cues under one pron cue → ONE group segment over union', () => {
    // Provider split 今 and 日 into separately-timed main cues, but the pron
    // track gives a single きょう cue covering both — one group ruby, no dup.
    const main = makeTrack([
      {
        value: '今日',
        cues: [
          { start: 0, value: '今', byteStart: 0, byteEnd: 2 },
          { start: 100, value: '日', byteStart: 3, byteEnd: 5 },
        ],
      },
    ])
    const pron = makeTrack([
      { value: 'きょう', cues: [{ start: 0, value: 'きょう', byteStart: 0, byteEnd: 8 }] },
    ])

    const result = alignPronunciation(main, pron)

    expect(result[0].segments).toHaveLength(1)
    expect(result[0].segments[0]).toMatchObject({
      charStart: 0,
      charEnd: 1,
      kana: 'きょう',
      nonSplittable: true,
    })
  })

  it('maps each line independently (multi-line)', () => {
    const main = makeTrack([
      { value: '食べる', cues: [{ start: 0, value: '食べる', byteStart: 0, byteEnd: 8 }] },
      { value: '今日', cues: [{ start: 1000, value: '今日', byteStart: 0, byteEnd: 5 }] },
    ])
    const pron = makeTrack([
      { value: 'たべる', cues: [{ start: 0, value: 'たべる', byteStart: 0, byteEnd: 8 }] },
      { value: 'きょう', cues: [{ start: 1000, value: 'きょう', byteStart: 0, byteEnd: 8 }] },
    ])

    const result = alignPronunciation(main, pron)

    expect(result).toHaveLength(2)
    expect(result[0].segments).toHaveLength(1)
    expect(result[0].segments[0]).toMatchObject({ charStart: 0, charEnd: 0, kana: 'た' })
    expect(result[1].segments).toHaveLength(1)
    expect(result[1].segments[0]).toMatchObject({
      charStart: 0,
      charEnd: 1,
      kana: 'きょう',
      nonSplittable: true,
    })
  })

  it('missing pron line → empty segments (no ruby)', () => {
    const main = makeTrack([
      { value: '食べる', cues: [{ start: 0, value: '食べる', byteStart: 0, byteEnd: 8 }] },
    ])
    const pron = makeTrack([])

    const result = alignPronunciation(main, pron)

    expect(result[0].segments).toHaveLength(0)
  })
})
