import { describe, expect, it } from 'vitest'
import type { RubyLineModel } from '@/types/furigana'
import {
  buildLineRenderSpans,
  type LineRenderSpan,
  normalizeLrcContent,
} from './lineRuby'

// Segment/perKanji charStart/charEnd are INCLUSIVE-end (alignLine ground truth,
// align.test.ts:61-72): a single kanji is {k, k}, a two-kanji group is {0, 1}.

// Every non-empty input must round-trip: the concatenation of span texts equals
// the source line, and each splittable span's cells re-tile its own text.
function expectConcatInvariant(spans: LineRenderSpan[], text: string): void {
  expect(spans.map((s) => s.text).join('')).toBe(text)
  for (const span of spans) {
    if (span.cells) {
      expect(span.cells.map((c) => c.text).join('')).toBe(span.text)
    }
  }
}

describe('normalizeLrcContent', () => {
  it('strips the single leading space injected after "]"', () => {
    expect(normalizeLrcContent(' 夜に駆ける')).toBe('夜に駆ける')
  })

  it('strips exactly ONE space, preserving further indentation', () => {
    expect(normalizeLrcContent('  indented')).toBe(' indented')
  })

  it('leaves content without a leading space unchanged', () => {
    expect(normalizeLrcContent('no-space')).toBe('no-space')
  })

  it('returns empty string unchanged', () => {
    expect(normalizeLrcContent('')).toBe('')
  })

  it('reduces a lone space to empty', () => {
    expect(normalizeLrcContent(' ')).toBe('')
  })
})

describe('buildLineRenderSpans', () => {
  it('returns [] for empty text', () => {
    expect(buildLineRenderSpans('', undefined)).toEqual([])
    expect(buildLineRenderSpans('', { segments: [] })).toEqual([])
  })

  it('returns a single bare span when the model is undefined', () => {
    const spans = buildLineRenderSpans('君の名前', undefined)
    expect(spans).toEqual([{ text: '君の名前' }])
    expectConcatInvariant(spans, '君の名前')
  })

  it('returns a single bare span when segments are empty', () => {
    const spans = buildLineRenderSpans('test', { segments: [] })
    expect(spans).toEqual([{ text: 'test' }])
    expectConcatInvariant(spans, 'test')
  })

  it('tiles a single mid-line splittable segment with surrounding bare runs', () => {
    const text = 'あの夏の日'
    const model: RubyLineModel = {
      segments: [
        {
          charStart: 2,
          charEnd: 2,
          kana: 'なつ',
          nonSplittable: false,
          perKanji: [{ charStart: 2, charEnd: 2, kana: 'なつ' }],
        },
      ],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([
      { text: 'あの' },
      { text: '夏', kana: 'なつ', cells: [{ text: '夏', kana: 'なつ' }] },
      { text: 'の日' },
    ])
    expectConcatInvariant(spans, text)
  })

  it('renders a jukujikun (nonSplittable) as one cell-free ruby span', () => {
    const text = '今日は晴れ'
    const model: RubyLineModel = {
      segments: [
        { charStart: 0, charEnd: 1, kana: 'きょう', nonSplittable: true },
      ],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([
      { text: '今日', kana: 'きょう' },
      { text: 'は晴れ' },
    ])
    expect(spans[0].cells).toBeUndefined()
    expectConcatInvariant(spans, text)
  })

  it('tiles a splittable segment with an internal okurigana gap', () => {
    const text = '取り引きする'
    const model: RubyLineModel = {
      segments: [
        {
          charStart: 0,
          charEnd: 3,
          kana: 'とりひき',
          nonSplittable: false,
          perKanji: [
            { charStart: 0, charEnd: 0, kana: 'と' },
            { charStart: 2, charEnd: 2, kana: 'ひ' },
          ],
        },
      ],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([
      {
        text: '取り引き',
        kana: 'とりひき',
        cells: [
          { text: '取', kana: 'と' },
          { text: 'り' },
          { text: '引', kana: 'ひ' },
          { text: 'き' },
        ],
      },
      { text: 'する' },
    ])
    expectConcatInvariant(spans, text)
  })

  it('emits a leading bare cell for okurigana before the first kanji', () => {
    const text = 'お土産'
    const model: RubyLineModel = {
      segments: [
        {
          charStart: 0,
          charEnd: 2,
          kana: 'おみやげ',
          nonSplittable: false,
          perKanji: [{ charStart: 1, charEnd: 2, kana: 'みやげ' }],
        },
      ],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([
      {
        text: 'お土産',
        kana: 'おみやげ',
        cells: [{ text: 'お' }, { text: '土産', kana: 'みやげ' }],
      },
    ])
    expectConcatInvariant(spans, text)
  })

  it('clamps an out-of-range charEnd instead of throwing', () => {
    const text = '空'
    const model: RubyLineModel = {
      segments: [
        { charStart: 0, charEnd: 999, kana: 'そら', nonSplittable: true },
      ],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([{ text: '空', kana: 'そら' }])
    expectConcatInvariant(spans, text)
  })

  it('treats a segment with neither kana nor perKanji as bare text', () => {
    const text = 'ひらがな'
    const model: RubyLineModel = {
      segments: [{ charStart: 0, charEnd: 3, nonSplittable: false }],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([{ text: 'ひらがな' }])
    expect(spans[0].kana).toBeUndefined()
    expectConcatInvariant(spans, text)
  })

  it('keeps the first of two overlapping segments and skips the rest', () => {
    const text = '東京都'
    const model: RubyLineModel = {
      segments: [
        { charStart: 0, charEnd: 1, kana: 'とうきょう', nonSplittable: true },
        { charStart: 1, charEnd: 1, kana: 'きょう', nonSplittable: true },
      ],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([
      { text: '東京', kana: 'とうきょう' },
      { text: '都' },
    ])
    expectConcatInvariant(spans, text)
  })

  it('sorts segments by charStart before walking the line', () => {
    const text = '今日と明日'
    const model: RubyLineModel = {
      segments: [
        { charStart: 3, charEnd: 4, kana: 'あした', nonSplittable: true },
        { charStart: 0, charEnd: 1, kana: 'きょう', nonSplittable: true },
      ],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([
      { text: '今日', kana: 'きょう' },
      { text: 'と' },
      { text: '明日', kana: 'あした' },
    ])
    expectConcatInvariant(spans, text)
  })

  it('handles multiple splittable segments with a bare gap between', () => {
    const text = '春夏秋冬'
    const model: RubyLineModel = {
      segments: [
        {
          charStart: 0,
          charEnd: 0,
          kana: 'はる',
          nonSplittable: false,
          perKanji: [{ charStart: 0, charEnd: 0, kana: 'はる' }],
        },
        {
          charStart: 2,
          charEnd: 2,
          kana: 'あき',
          nonSplittable: false,
          perKanji: [{ charStart: 2, charEnd: 2, kana: 'あき' }],
        },
      ],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([
      { text: '春', kana: 'はる', cells: [{ text: '春', kana: 'はる' }] },
      { text: '夏' },
      { text: '秋', kana: 'あき', cells: [{ text: '秋', kana: 'あき' }] },
      { text: '冬' },
    ])
    expectConcatInvariant(spans, text)
  })

  it('does not mutate its inputs', () => {
    const model: RubyLineModel = {
      segments: [
        {
          charStart: 0,
          charEnd: 3,
          kana: 'とりひき',
          nonSplittable: false,
          perKanji: [
            { charStart: 2, charEnd: 2, kana: 'ひ' },
            { charStart: 0, charEnd: 0, kana: 'と' },
          ],
        },
      ],
    }
    const snapshot = JSON.stringify(model)
    buildLineRenderSpans('取り引き', model)
    expect(JSON.stringify(model)).toBe(snapshot)
  })

  // --- Regression: inclusive-end ranges (the 貴方 / 田園 production bug) ---

  it('regression 貴方: jukujikun reading covers the WHOLE group, not just 貴', () => {
    const text = '貴方'
    const model: RubyLineModel = {
      segments: [
        { charStart: 0, charEnd: 1, kana: 'あなた', nonSplittable: true },
      ],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([{ text: '貴方', kana: 'あなた' }])
    expectConcatInvariant(spans, text)
  })

  it('regression 田園: per-kanji readings land over BOTH kanji ({0,0}+{1,1})', () => {
    const text = '田園'
    const model: RubyLineModel = {
      segments: [
        {
          charStart: 0,
          charEnd: 1,
          kana: 'でんえん',
          nonSplittable: false,
          perKanji: [
            { charStart: 0, charEnd: 0, kana: 'でん' },
            { charStart: 1, charEnd: 1, kana: 'えん' },
          ],
        },
      ],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([
      {
        text: '田園',
        kana: 'でんえん',
        cells: [
          { text: '田', kana: 'でん' },
          { text: '園', kana: 'えん' },
        ],
      },
    ])
    expectConcatInvariant(spans, text)
  })

  it('merges colliding per-kanji readings into group-ruby (大丈夫)', () => {
    const text = '大丈夫'
    const model: RubyLineModel = {
      segments: [
        {
          charStart: 0,
          charEnd: 2,
          kana: 'だいじょうぶ',
          nonSplittable: false,
          perKanji: [
            { charStart: 0, charEnd: 0, kana: 'だい' },
            { charStart: 1, charEnd: 1, kana: 'じょう' },
            { charStart: 2, charEnd: 2, kana: 'ぶ' },
          ],
        },
      ],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([
      {
        text: '大丈夫',
        kana: 'だいじょうぶ',
        cells: [
          { text: '大丈', kana: 'だいじょう' },
          { text: '夫', kana: 'ぶ' },
        ],
      },
    ])
    expectConcatInvariant(spans, text)
  })

  it('merges colliding readings across a SEPARATE-segment boundary', () => {
    const text = '心技'
    const model: RubyLineModel = {
      segments: [
        {
          charStart: 0,
          charEnd: 0,
          kana: 'こころ',
          nonSplittable: false,
          perKanji: [{ charStart: 0, charEnd: 0, kana: 'こころ' }],
        },
        {
          charStart: 1,
          charEnd: 1,
          kana: 'わざ',
          nonSplittable: false,
          perKanji: [{ charStart: 1, charEnd: 1, kana: 'わざ' }],
        },
      ],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([
      {
        text: '心技',
        kana: 'こころわざ',
        cells: [{ text: '心技', kana: 'こころわざ' }],
      },
    ])
    expectConcatInvariant(spans, text)
  })

  it('regression 泥の花: single-kanji {k,k} segments are NOT dropped', () => {
    const text = '泥の花'
    const model: RubyLineModel = {
      segments: [
        {
          charStart: 0,
          charEnd: 0,
          kana: 'どろ',
          nonSplittable: false,
          perKanji: [{ charStart: 0, charEnd: 0, kana: 'どろ' }],
        },
        {
          charStart: 2,
          charEnd: 2,
          kana: 'はな',
          nonSplittable: false,
          perKanji: [{ charStart: 2, charEnd: 2, kana: 'はな' }],
        },
      ],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([
      { text: '泥', kana: 'どろ', cells: [{ text: '泥', kana: 'どろ' }] },
      { text: 'の' },
      { text: '花', kana: 'はな', cells: [{ text: '花', kana: 'はな' }] },
    ])
    expectConcatInvariant(spans, text)
  })

  it('regression single kanji: {0,0} nonSplittable annotates the whole char', () => {
    const text = '空'
    const model: RubyLineModel = {
      segments: [
        { charStart: 0, charEnd: 0, kana: 'そら', nonSplittable: true },
      ],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([{ text: '空', kana: 'そら' }])
    expectConcatInvariant(spans, text)
  })
})
