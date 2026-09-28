import { describe, expect, it } from 'vitest'
import type { RubyLineModel, RubyLineSegment } from '@/types/furigana'
import type {
  NormalizedCue,
  NormalizedStructuredLyric,
} from '@/utils/wordTiming'
import { alignPronunciation } from './alignPronunciation'
import { buildLineRenderSpans, type LineRenderSpan } from './lineRuby'

// One-line track shaped like a navidrome lyricsfile payload. Each cue is found
// in the line value by a forward scan (pron cues skip the unread "baby"), and
// its byte offsets run over that value with an INCLUSIVE byteEnd.
function makeTrack(
  value: string,
  cues: Array<{ value: string; start: number; end: number }>,
  lang?: string,
): NormalizedStructuredLyric {
  const utf8 = new TextEncoder()
  let from = 0
  const timed: NormalizedCue[] = cues.map((cue) => {
    const at = value.indexOf(cue.value, from)
    if (at < 0) throw new Error(`cue "${cue.value}" not in "${value}"`)
    from = at + cue.value.length
    const byteStart = utf8.encode(value.slice(0, at)).length
    const byteEnd = byteStart + utf8.encode(cue.value).length - 1
    return { ...cue, byteStart, byteEnd }
  })
  const start = timed[0].start
  const end = timed[timed.length - 1].end
  return {
    lang,
    kind: 'main',
    synced: true,
    agents: [],
    hasWordTiming: true,
    breaks: [],
    lines: [
      {
        start,
        end,
        value,
        cueLines: [
          {
            lineIndex: 0,
            key: '0:pos0',
            displayOrder: 0,
            start,
            end,
            value,
            cues: timed,
          },
        ],
      },
    ],
  }
}

// The concatenation of span texts equals the source line, and each splittable
// span's cells re-tile its own text (lineRuby.test.ts's invariant).
function expectConcatInvariant(spans: LineRenderSpan[], text: string): void {
  expect(spans.map((s) => s.text).join('')).toBe(text)
  for (const span of spans) {
    if (span.cells) {
      expect(span.cells.map((c) => c.text).join('')).toBe(span.text)
    }
  }
}

// Spread readings sit centred at natural width: nothing is shifted off-centre
// or condensed, on a span or on any of its cells.
function expectNoTrackingOrShift(spans: LineRenderSpan[]): void {
  for (const piece of [...spans, ...spans.flatMap((s) => s.cells ?? [])]) {
    expect(piece.tracking).toBeUndefined()
    expect(piece.shift).toBeUndefined()
  }
}

// Canonical aonsoku ZH fixture: trailing-space main cues 100ms apart, and a
// zh-latn pron track with no cue for the English word.
const zhText = '我爱你 baby 走吧'
const slot = (i: number) => ({ start: i * 100, end: (i + 1) * 100 })
const zhMain = makeTrack(
  zhText,
  ['我', '爱', '你 ', 'ba', 'by ', '走', '吧'].map((value, i) => ({
    value,
    ...slot(i),
  })),
)
const zhPron = makeTrack(
  'wǒ ài nǐ baby zǒu ba',
  [
    { value: 'wǒ', ...slot(0) },
    { value: 'ài', ...slot(1) },
    { value: 'nǐ', ...slot(2) },
    { value: 'zǒu', ...slot(5) },
    { value: 'ba', ...slot(6) },
  ],
  'zh-latn',
)
const [zhAligned] = alignPronunciation(zhMain, zhPron)

// Long-syllable fixture: one segment per hanzi, the shape alignPronunciation
// emits for single-hanzi pinyin cues.
const longText = '床前明月光'
const longReadings = ['chuáng', 'qián', 'míng', 'yuè', 'guāng']
const longSegments: RubyLineSegment[] = longReadings.map((kana, i) => ({
  charStart: i,
  charEnd: i,
  kana,
  nonSplittable: true,
}))

describe('buildLineRenderSpans in spread mode', () => {
  it('gives each hanzi of the ZH fixture its own spread span, baby bare', () => {
    // The Latin edge-whitespace peel puts nǐ over 你 alone, so the space
    // before baby stays out of the ruby unit.
    const spans = buildLineRenderSpans(zhText, { ...zhAligned, spread: true })
    expect(spans).toEqual([
      { text: '我', kana: 'wǒ', spread: true },
      { text: '爱', kana: 'ài', spread: true },
      { text: '你', kana: 'nǐ', spread: true },
      { text: ' baby ' },
      { text: '走', kana: 'zǒu', spread: true },
      { text: '吧', kana: 'ba', spread: true },
    ])
    // Bare text is never flagged: it has no unit to widen.
    expect(spans[3]).toStrictEqual({ text: ' baby ' })
    expectNoTrackingOrShift(spans)
    expectConcatInvariant(spans, zhText)
  })

  it('keeps 床前明月光 as 5 separate ruby spans, never merged', () => {
    // Shifting and condensing can't clear readings this wide, so the default
    // path merges neighbours into group ruby.
    const merged = buildLineRenderSpans(longText, { segments: longSegments })
    expect(merged.length).toBeLessThan(5)

    const spans = buildLineRenderSpans(longText, {
      segments: longSegments,
      spread: true,
    })
    expect(spans).toEqual(
      longReadings.map((kana, i) => ({
        text: longText[i],
        kana,
        spread: true,
      })),
    )
    expectNoTrackingOrShift(spans)
    expectConcatInvariant(spans, longText)
  })

  it('tiles a perKanji spread segment into natural-width cells', () => {
    // perKanji only comes from hand-built models; 月 stands in for a bare gap.
    const text = '明月光'
    const model: RubyLineModel = {
      spread: true,
      segments: [
        {
          charStart: 0,
          charEnd: 2,
          kana: 'míngyuèguāng',
          nonSplittable: false,
          perKanji: [
            { charStart: 0, charEnd: 0, kana: 'míng' },
            { charStart: 2, charEnd: 2, kana: 'guāng' },
          ],
        },
      ],
    }
    const spans = buildLineRenderSpans(text, model)
    expect(spans).toEqual([
      {
        text: '明月光',
        kana: 'míngyuèguāng',
        spread: true,
        cells: [
          { text: '明', kana: 'míng' },
          { text: '月' },
          { text: '光', kana: 'guāng' },
        ],
      },
    ])
    expectNoTrackingOrShift(spans)
    expectConcatInvariant(spans, text)
  })

  it('drops overlapping segments and clamps overlong ones like the default path', () => {
    const model: RubyLineModel = {
      spread: true,
      segments: [
        { charStart: 1, charEnd: 1, kana: 'qián', nonSplittable: true },
        { charStart: 0, charEnd: 1, kana: 'chuángqián', nonSplittable: true },
        { charStart: 4, charEnd: 99, kana: 'guāng', nonSplittable: true },
      ],
    }
    const spans = buildLineRenderSpans(longText, model)
    expect(spans).toEqual([
      { text: '床前', kana: 'chuángqián', spread: true },
      { text: '明月' },
      { text: '光', kana: 'guāng', spread: true },
    ])
    expectConcatInvariant(spans, longText)
  })

  it('leaves models without the flag on the default path, unflagged', () => {
    const { segments } = zhAligned
    for (const model of [{ segments }, { segments, spread: false }]) {
      const spans = buildLineRenderSpans(zhText, model)
      expect(spans.some((s) => 'spread' in s)).toBe(false)
      // The default path moves zǒu off-centre (or condenses it) to clear ba.
      expect(
        spans.some((s) => s.shift !== undefined || s.tracking !== undefined),
      ).toBe(true)
      expectConcatInvariant(spans, zhText)
    }
  })

  it('does not mutate its inputs', () => {
    const model: RubyLineModel = { segments: longSegments, spread: true }
    const snapshot = JSON.stringify(model)
    buildLineRenderSpans(longText, model)
    expect(JSON.stringify(model)).toBe(snapshot)
  })
})
