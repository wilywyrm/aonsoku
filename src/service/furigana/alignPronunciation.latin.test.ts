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

describe('alignPronunciation (Latin & JA regression)', () => {
  describe('JA pins (regression guard — kana readings must be unchanged)', () => {
    it('今日 (trailing space) + きょう (hiragana) → space stays in base, nonSplittable false (current behavior)', () => {
      const main = makeTrack([
        {
          value: '今日 ',
          cues: [{ start: 0, value: '今日 ', byteStart: 0, byteEnd: 6 }],
        },
      ])
      const pron = makeTrack([
        {
          value: 'きょう',
          cues: [{ start: 0, value: 'きょう', byteStart: 0, byteEnd: 8 }],
        },
      ])

      const result = alignPronunciation(main, pron)

      expect(result[0].segments).toHaveLength(1)
      expect(result[0].segments[0].kana).toBe('きょう')
      expect(result[0].segments[0].charStart).toBe(0)
      expect(result[0].segments[0].charEnd).toBe(1)
      expect(result[0].segments[0].nonSplittable).toBe(false)
    })

    it('珈琲 (trailing space) + コーヒー (katakana) → space stays in base, charEnd 2 (current behavior)', () => {
      const main = makeTrack([
        {
          value: '珈琲 ',
          cues: [{ start: 0, value: '珈琲 ', byteStart: 0, byteEnd: 6 }],
        },
      ])
      const pron = makeTrack([
        {
          value: 'コーヒー',
          cues: [{ start: 0, value: 'コーヒー', byteStart: 0, byteEnd: 11 }],
        },
      ])

      const result = alignPronunciation(main, pron)

      expect(result[0].segments).toHaveLength(1)
      expect(result[0].segments[0].kana).toBe('コーヒー')
      expect(result[0].segments[0].charStart).toBe(0)
      expect(result[0].segments[0].charEnd).toBe(2)
      expect(result[0].segments[0].nonSplittable).toBe(true)
    })

    it('食べる + たべる (hiragana) → ruby た over 食 only (べる bare)', () => {
      const main = makeTrack([
        {
          value: '食べる',
          cues: [{ start: 0, value: '食べる', byteStart: 0, byteEnd: 8 }],
        },
      ])
      const pron = makeTrack([
        {
          value: 'たべる',
          cues: [{ start: 0, value: 'たべる', byteStart: 0, byteEnd: 8 }],
        },
      ])

      const result = alignPronunciation(main, pron)

      expect(result[0].segments).toHaveLength(1)
      expect(result[0].segments[0].kana).toBe('た')
      expect(result[0].segments[0].charStart).toBe(0)
      expect(result[0].segments[0].charEnd).toBe(0)
      expect(result[0].segments[0].nonSplittable).toBe(false)
    })
  })

  describe('Latin (no kana) — NEW behaviour: edge whitespace excluded from ruby core', () => {
    it('你 (trailing space) + nǐ (Latin pinyin) → space excluded from core', () => {
      const main = makeTrack([
        {
          value: '你 ',
          cues: [{ start: 0, value: '你 ', byteStart: 0, byteEnd: 3 }],
        },
      ])
      const pron = makeTrack([
        {
          value: 'nǐ',
          cues: [{ start: 0, value: 'nǐ', byteStart: 0, byteEnd: 2 }],
        },
      ])

      const result = alignPronunciation(main, pron)

      expect(result[0].segments).toHaveLength(1)
      expect(result[0].segments[0].kana).toBe('nǐ')
      expect(result[0].segments[0].charStart).toBe(0)
      expect(result[0].segments[0].charEnd).toBe(0)
      expect(result[0].segments[0].nonSplittable).toBe(true)
    })

    it('壮， (punctuation) + zhuàng (Latin pinyin) → covers 壮 only (existing punct peel)', () => {
      const main = makeTrack([
        {
          value: '壮，',
          cues: [{ start: 0, value: '壮，', byteStart: 0, byteEnd: 5 }],
        },
      ])
      const pron = makeTrack([
        {
          value: 'zhuàng',
          cues: [{ start: 0, value: 'zhuàng', byteStart: 0, byteEnd: 6 }],
        },
      ])

      const result = alignPronunciation(main, pron)

      expect(result[0].segments).toHaveLength(1)
      expect(result[0].segments[0].kana).toBe('zhuàng')
      expect(result[0].segments[0].charStart).toBe(0)
      expect(result[0].segments[0].charEnd).toBe(0)
      expect(result[0].segments[0].nonSplittable).toBe(true)
    })

    it('你好 (trailing space) + nǐ hǎo (Latin pinyin) → space excluded, covers both chars', () => {
      const main = makeTrack([
        {
          value: '你好 ',
          cues: [{ start: 0, value: '你好 ', byteStart: 0, byteEnd: 6 }],
        },
      ])
      const pron = makeTrack([
        {
          value: 'nǐ hǎo',
          cues: [{ start: 0, value: 'nǐ hǎo', byteStart: 0, byteEnd: 7 }],
        },
      ])

      const result = alignPronunciation(main, pron)

      expect(result[0].segments).toHaveLength(1)
      expect(result[0].segments[0].kana).toBe('nǐ hǎo')
      expect(result[0].segments[0].charStart).toBe(0)
      expect(result[0].segments[0].charEnd).toBe(1)
      expect(result[0].segments[0].nonSplittable).toBe(true)
    })

    it('你, (comma + space) + nǐ (Latin pinyin) → space and comma excluded from core', () => {
      const main = makeTrack([
        {
          value: '你, ',
          cues: [{ start: 0, value: '你, ', byteStart: 0, byteEnd: 4 }],
        },
      ])
      const pron = makeTrack([
        {
          value: 'nǐ',
          cues: [{ start: 0, value: 'nǐ', byteStart: 0, byteEnd: 2 }],
        },
      ])

      const result = alignPronunciation(main, pron)

      expect(result[0].segments).toHaveLength(1)
      expect(result[0].segments[0].kana).toBe('nǐ')
      expect(result[0].segments[0].charStart).toBe(0)
      expect(result[0].segments[0].charEnd).toBe(0)
      expect(result[0].segments[0].nonSplittable).toBe(true)
    })

    it('你， (fullwidth comma + space) + nǐ (Latin pinyin) → space and comma excluded from core', () => {
      const main = makeTrack([
        {
          value: '你， ',
          cues: [{ start: 0, value: '你， ', byteStart: 0, byteEnd: 5 }],
        },
      ])
      const pron = makeTrack([
        {
          value: 'nǐ',
          cues: [{ start: 0, value: 'nǐ', byteStart: 0, byteEnd: 2 }],
        },
      ])

      const result = alignPronunciation(main, pron)

      expect(result[0].segments).toHaveLength(1)
      expect(result[0].segments[0].kana).toBe('nǐ')
      expect(result[0].segments[0].charStart).toBe(0)
      expect(result[0].segments[0].charEnd).toBe(0)
      expect(result[0].segments[0].nonSplittable).toBe(true)
    })
  })
})
