import { describe, expect, it } from 'vitest'
import type { RubyLineModel } from '@/types/furigana'
import type { NormalizedCue } from '@/utils/wordTiming'
import { reconcile } from './reconcile'

// Build a cue covering `sub` within `lineValue`, computing UTF-8 byte offsets
// (byteEnd INCLUSIVE, matching byteSlice) the way a real server payload would.
function cueFor(
  lineValue: string,
  sub: string,
  extra: Partial<NormalizedCue> = {},
): NormalizedCue {
  const enc = new TextEncoder()
  const idx = lineValue.indexOf(sub)
  const byteStart = enc.encode(lineValue.slice(0, idx)).length
  const byteEnd = byteStart + enc.encode(sub).length - 1
  return { start: 0, end: 1000, value: sub, byteStart, byteEnd, ...extra }
}

describe('reconcile', () => {
  it('keeps a per-kanji compound as ONE unit spanning both cues (東|京)', () => {
    const model: RubyLineModel = {
      segments: [
        {
          charStart: 0,
          charEnd: 1,
          kana: 'とうきょう',
          nonSplittable: false,
          perKanji: [
            { charStart: 0, charEnd: 0, kana: 'とう' },
            { charStart: 1, charEnd: 1, kana: 'きょう' },
          ],
        },
      ],
    }
    const cues = [cueFor('東京', '東'), cueFor('東京', '京')]

    const units = reconcile(model, cues, '東京')

    expect(units.length).toBe(1)
    expect(units[0]).toMatchObject({
      charStart: 0,
      charEnd: 1,
      kana: 'とうきょう',
      nonSplittable: false,
      coveringCueIdx: [0, 1],
    })
    expect(units[0].perKanji).toEqual([
      { charStart: 0, charEnd: 0, kana: 'とう' },
      { charStart: 1, charEnd: 1, kana: 'きょう' },
    ])
    expect(units[0].cueCharCounts).toEqual([1, 1])
  })

  it('keeps a straddling jukujikun as ONE unit spanning both cues (大人)', () => {
    const model: RubyLineModel = {
      segments: [
        { charStart: 0, charEnd: 1, kana: 'おとな', nonSplittable: true },
      ],
    }
    const cues = [cueFor('大人', '大'), cueFor('大人', '人')]

    const units = reconcile(model, cues, '大人')

    expect(units.length).toBe(1)
    expect(units[0]).toMatchObject({
      charStart: 0,
      charEnd: 1,
      kana: 'おとな',
      nonSplittable: true,
      coveringCueIdx: [0, 1],
    })
    expect(units[0].cueCharCounts).toEqual([1, 1])
  })

  it('degrades a cue with out-of-range byte offsets to bare text (no throw)', () => {
    const model: RubyLineModel = {
      segments: [
        {
          charStart: 0,
          charEnd: 0,
          kana: 'あずま',
          nonSplittable: false,
          perKanji: [{ charStart: 0, charEnd: 0, kana: 'あずま' }],
        },
      ],
    }
    const cues: NormalizedCue[] = [
      { start: 0, end: 1000, value: '東', byteStart: 999, byteEnd: 1000 },
    ]

    const units = reconcile(model, cues, '東')

    expect(units.length).toBe(1)
    expect(units[0].kana).toBeUndefined()
  })

  it('renders a whitespace-only cue as a bare unit', () => {
    const model: RubyLineModel = { segments: [] }
    const cues = [cueFor(' ', ' ')]

    const units = reconcile(model, cues, ' ')

    expect(units.length).toBe(1)
    expect(units[0].kana).toBeUndefined()
  })

  it('renders a kana-only (bare) segment without ruby', () => {
    const model: RubyLineModel = {
      segments: [{ charStart: 0, charEnd: 3, nonSplittable: false }],
    }
    const cues = [cueFor('ひらがな', 'ひらがな')]

    const units = reconcile(model, cues, 'ひらがな')

    expect(units.every((u) => u.kana === undefined)).toBe(true)
  })

  it('does not mutate its inputs', () => {
    const model: RubyLineModel = {
      segments: [
        { charStart: 0, charEnd: 1, kana: 'おとな', nonSplittable: true },
      ],
    }
    const cues = [cueFor('大人', '大'), cueFor('大人', '人')]
    const modelSnapshot = JSON.stringify(model)
    const cuesSnapshot = JSON.stringify(cues)

    reconcile(model, cues, '大人')

    expect(JSON.stringify(model)).toBe(modelSnapshot)
    expect(JSON.stringify(cues)).toBe(cuesSnapshot)
  })
})
