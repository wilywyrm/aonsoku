import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { alignPronunciation } from '@/service/furigana/alignPronunciation'
import type { RubyLineModel } from '@/types/furigana'
import type {
  NormalizedCue,
  NormalizedStructuredLyric,
} from '@/utils/wordTiming'
import { LineRubyContent } from './line-ruby-content'

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

// alignPronunciation's model for a one-line pair, flagged spread the way
// useRubyModels flags every model of a zh-Latn ruby system.
function spreadModel(
  main: NormalizedStructuredLyric,
  pron: NormalizedStructuredLyric,
): RubyLineModel {
  const [model] = alignPronunciation(main, pron)
  return { ...model, spread: true }
}

function renderLine(text: string, model: RubyLineModel): string {
  return renderToStaticMarkup(<LineRubyContent text={text} model={model} />)
}

// A one-reading spread unit: the hidden sizer copy of the reading comes FIRST,
// then the same base and overlay a static unit renders.
function spreadUnit(base: string, reading: string): string {
  return [
    '<span class="ruby-unit ruby-static ruby-spread" data-testid="line-ruby-unit">',
    `<span class="ruby-spread-sizer" aria-hidden="true">${reading}</span>`,
    `<span class="ruby-base">${base}</span>`,
    '<span class="ruby-furi" aria-hidden="true"><span class="ruby-furi-cell">',
    `<span class="ruby-furi-spacer">${base}</span>`,
    `<span class="ruby-furi-rt">${reading}</span>`,
    '</span></span></span>',
  ].join('')
}

// Every ruby unit is spread, and within each unit's markup (up to the next
// unit) the sizer precedes the base and no --rt-* property is emitted.
function expectSpreadUnits(markup: string, count: number): void {
  const units = markup.split('<span class="ruby-unit ').slice(1)
  expect(units).toHaveLength(count)
  for (const unit of units) {
    expect(unit).toMatch(/^ruby-static ruby-spread"/)
    const sizer = unit.indexOf('ruby-spread-sizer')
    expect(sizer).toBeGreaterThan(-1)
    expect(sizer).toBeLessThan(unit.indexOf('ruby-base'))
    expect(unit).not.toContain('--rt-')
  }
}

const slot = (i: number) => ({ start: i * 100, end: (i + 1) * 100 })

// Canonical aonsoku ZH fixture: trailing-space main cues, and a zh-latn pron
// track with no cue for the English word.
const zhText = '我爱你 baby 走吧'
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

// Punct fixture: ， shares 壮's cue, and the line pinyin drops it.
const punctText = '壮，丽'
const punctMain = makeTrack(punctText, [
  { value: '壮，', ...slot(0) },
  { value: '丽', ...slot(1) },
])
const punctPron = makeTrack(
  'zhuàng lì',
  [
    { value: 'zhuàng', ...slot(0) },
    { value: 'lì', ...slot(1) },
  ],
  'zh-latn',
)

describe('LineRubyContent spread units', () => {
  it('renders each ZH fixture hanzi as a spread unit sized by its pinyin', () => {
    const markup = renderLine(zhText, spreadModel(zhMain, zhPron))
    expect(markup).toContain('ruby-spread')
    expectSpreadUnits(markup, 5)
    expect(markup).toBe(
      [
        '<p>',
        spreadUnit('我', 'wǒ'),
        spreadUnit('爱', 'ài'),
        spreadUnit('你', 'nǐ'),
        ' baby ',
        spreadUnit('走', 'zǒu'),
        spreadUnit('吧', 'ba'),
        '</p>',
      ].join(''),
    )
  })

  it('sizes 壮 by zhuàng alone and leaves ， bare (punct fixture)', () => {
    const markup = renderLine(punctText, spreadModel(punctMain, punctPron))
    expect(markup).toContain('>zhuàng<')
    expectSpreadUnits(markup, 2)
    expect(markup).toBe(
      `<p>${spreadUnit('壮', 'zhuàng')}，${spreadUnit('丽', 'lì')}</p>`,
    )
  })

  it('gives each hanzi of 床前明月光 its own spread unit', () => {
    const readings = ['chuáng', 'qián', 'míng', 'yuè', 'guāng']
    const model: RubyLineModel = {
      spread: true,
      segments: readings.map((kana, i) => ({
        charStart: i,
        charEnd: i,
        kana,
        nonSplittable: true,
      })),
    }
    const markup = renderLine('床前明月光', model)
    expectSpreadUnits(markup, 5)
    expect(markup).toBe(
      `<p>${[...'床前明月光'].map((c, i) => spreadUnit(c, readings[i])).join('')}</p>`,
    )
  })

  it('sizes a multi-reading unit by its readings joined with single spaces', () => {
    // perKanji only comes from hand-built models; 月 stands in for a bare gap.
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
    const markup = renderLine('明月光', model)
    expectSpreadUnits(markup, 1)
    expect(markup).toBe(
      [
        '<p><span class="ruby-unit ruby-static ruby-spread" data-testid="line-ruby-unit">',
        '<span class="ruby-spread-sizer" aria-hidden="true">míng guāng</span>',
        '<span class="ruby-base">明月光</span>',
        '<span class="ruby-furi" aria-hidden="true">',
        '<span class="ruby-furi-cell"><span class="ruby-furi-spacer">明</span>',
        '<span class="ruby-furi-rt">míng</span></span>',
        '<span class="ruby-furi-gap">月</span>',
        '<span class="ruby-furi-cell"><span class="ruby-furi-spacer">光</span>',
        '<span class="ruby-furi-rt">guāng</span></span>',
        '</span></span></p>',
      ].join(''),
    )
  })

  it('renders no spread markup for a model without the flag', () => {
    const [model] = alignPronunciation(zhMain, zhPron)
    const markup = renderLine(zhText, model)
    expect(markup).not.toContain('ruby-spread')
    // The default path still resolves zǒu's collision with ba.
    expect(markup).toContain('--rt-')
  })
})
