import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { alignPronunciation } from '@/service/furigana/alignPronunciation'
import type { RubyUnitLayout } from '@/service/furigana/layout'
import { reconcile } from '@/service/furigana/reconcile'
import { resolveSpreadUnitLayout } from '@/service/furigana/spreadLayout'
import { computeWipeLayout, unitWipePct } from '@/service/furigana/wipeFront'
import type { RenderUnit, RubyLineModel } from '@/types/furigana'
import type {
  NormalizedCue,
  NormalizedCueLine,
  NormalizedStructuredLyric,
} from '@/utils/wordTiming'
import { RubyCueContent } from './ruby-cue-content'

const utf8 = new TextEncoder()

// One-line track shaped like a lyricsfile payload. Each cue is located in the
// line value in order (pinyin cues skip the spaces between syllables) and gets
// byte offsets with an INCLUSIVE byteEnd, which reconcile requires.
function makeTrack(
  value: string,
  cues: Array<{ value: string; start: number; end: number }>,
): NormalizedStructuredLyric {
  let cursor = 0
  const timed: NormalizedCue[] = cues.map((c) => {
    const at = value.indexOf(c.value, cursor)
    cursor = at + c.value.length
    const byteStart = utf8.encode(value.slice(0, at)).length
    const byteEnd = byteStart + utf8.encode(c.value).length - 1
    return { ...c, byteStart, byteEnd }
  })
  const start = timed[0].start
  const end = timed[timed.length - 1].end
  return {
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

function cue(value: string, start: number) {
  return { value, start, end: start + 100 }
}

function pinyinTrack(
  value: string,
  cues: Array<{ value: string; start: number; end: number }>,
): NormalizedStructuredLyric {
  return { ...makeTrack(value, cues), kind: 'pronunciation', lang: 'zh-latn' }
}

// Canonical aonsoku ZH ruby fixture: trailing-space word cues 100 ms apart,
// pinyin cues sharing the timing of the hanzi they read.
const zhMain = makeTrack(
  '我爱你 baby 走吧',
  ['我', '爱', '你 ', 'ba', 'by ', '走', '吧'].map((v, i) => cue(v, i * 100)),
)
const zhPron = pinyinTrack('wǒ ài nǐ baby zǒu ba', [
  cue('wǒ', 0),
  cue('ài', 100),
  cue('nǐ', 200),
  cue('zǒu', 500),
  cue('ba', 600),
])

const punctMain = makeTrack('壮，丽', [cue('壮，', 0), cue('丽', 100)])
const punctPron = pinyinTrack('zhuàng lì', [cue('zhuàng', 0), cue('lì', 100)])

// What the word-level container computes for line 0's cueLine once the model
// is flagged spread (markSpread does this for a zh-Latn ruby system).
function spreadPipeline(
  main: NormalizedStructuredLyric,
  pron: NormalizedStructuredLyric,
): { cueLine: NormalizedCueLine; units: RenderUnit[]; layout: RubyUnitLayout } {
  const cueLine = main.lines[0].cueLines[0]
  const model: RubyLineModel = {
    ...alignPronunciation(main, pron)[0],
    spread: true,
  }
  const units = reconcile(model, cueLine.cues, cueLine.value)
  return { cueLine, units, layout: resolveSpreadUnitLayout(units) }
}

function render(layout: RubyUnitLayout, cueLine: NormalizedCueLine): string {
  return renderToStaticMarkup(
    <RubyCueContent
      units={layout.units}
      groups={layout.groups}
      lineIdx={0}
      cueLine={cueLine}
      isLineActive={false}
      activeLineIdx={-1}
      activeCueIdx={-1}
      lastVisitedCueIdx={-1}
      onWordClick={() => {}}
    />,
  )
}

function count(markup: string, needle: string): number {
  return markup.split(needle).length - 1
}

// Opening tag of a unit's interactive outer span (idle future line, so dim).
function outerOpen(cueIdx: number, unitIdx: number): string {
  return `<span data-testid="word-unit-0-0:pos0-${cueIdx}-${unitIdx}" data-state="future" class="cursor-pointer hover:opacity-100 [word-break:keep-all] opacity-50" tabindex="0">`
}

// A spread unit's inner .ruby-unit up to its base: the sizer comes first.
function spreadOpen(sizer: string, base: string): string {
  return `<span class="ruby-unit ruby-spread"><span class="ruby-spread-sizer" aria-hidden="true">${sizer}</span><span class="ruby-base">${base}</span>`
}

describe('RubyCueContent spread (pinyin) units', () => {
  it('puts ruby-spread and a pinyin sizer on the inner span of each hanzi unit', () => {
    const { cueLine, layout } = spreadPipeline(zhMain, zhPron)
    const markup = render(layout, cueLine)

    // 你's trailing space is a bare unit of its own, so from ba on the unit
    // index runs one ahead of the cue index.
    const hanzi: Array<[number, number, string, string]> = [
      [0, 0, 'wǒ', '我'],
      [1, 1, 'ài', '爱'],
      [2, 2, 'nǐ', '你'],
      [5, 6, 'zǒu', '走'],
      [6, 7, 'ba', '吧'],
    ]
    for (const [cueIdx, unitIdx, pinyin, base] of hanzi) {
      expect(markup).toContain(
        outerOpen(cueIdx, unitIdx) + spreadOpen(pinyin, base),
      )
      // Spread groups carry no shift or tracking: only the wipe vars remain.
      expect(markup).toContain(
        `<span class="ruby-furi-rt" style="--seg-start:0%;--seg-span:1">${pinyin}</span>`,
      )
    }
    expect(count(markup, 'class="ruby-unit ruby-spread"')).toBe(5)
    expect(count(markup, 'class="ruby-spread-sizer"')).toBe(5)
    expect(count(markup, 'class="ruby-furi-rt"')).toBe(5)
    expect(markup).not.toContain('--rt-')
  })

  it('renders ba and by as bare units', () => {
    const { cueLine, layout } = spreadPipeline(zhMain, zhPron)
    const markup = render(layout, cueLine)

    expect(markup).toContain(`${outerOpen(3, 4)}ba</span>`)
    expect(markup).toContain(`${outerOpen(4, 5)}by </span>`)
  })

  it('keeps same-cue punctuation out of the spread unit (壮，丽)', () => {
    const { cueLine, layout } = spreadPipeline(punctMain, punctPron)

    expect(layout.units.map((u) => u.kanjiText)).toEqual(['壮', '，', '丽'])
    const markup = render(layout, cueLine)
    // The sizer holds exactly zhuàng, over a base of 壮 alone.
    expect(markup).toContain(outerOpen(0, 0) + spreadOpen('zhuàng', '壮'))
    expect(markup).toContain(`${outerOpen(0, 1)}，</span>`)
    expect(markup).toContain(outerOpen(1, 2) + spreadOpen('lì', '丽'))
  })

  it('joins the readings of a multi-reading unit with a space in its sizer', () => {
    // alignPronunciation emits one reading per pinyin cue; only a hand-built
    // model gives a unit per-hanzi readings.
    const track = makeTrack('明月', [cue('明月', 0)])
    const cueLine = track.lines[0].cueLines[0]
    const model: RubyLineModel = {
      segments: [
        {
          charStart: 0,
          charEnd: 1,
          kana: 'míngyuè',
          nonSplittable: false,
          perKanji: [
            { charStart: 0, charEnd: 0, kana: 'míng' },
            { charStart: 1, charEnd: 1, kana: 'yuè' },
          ],
        },
      ],
    }
    const layout = resolveSpreadUnitLayout(
      reconcile(model, cueLine.cues, cueLine.value),
    )
    const markup = render(layout, cueLine)

    expect(markup).toContain(spreadOpen('míng yuè', '明月'))
    expect(markup).toContain(
      'style="--seg-start:0%;--seg-span:0.5">míng</span>',
    )
    expect(markup).toContain(
      'style="--seg-start:50%;--seg-span:0.5">yuè</span>',
    )
  })

  it('leaves the char-based wipe bookkeeping untouched (壮，丽)', () => {
    const { units, layout } = spreadPipeline(punctMain, punctPron)
    const wipe = computeWipeLayout(layout.units, 2)

    // 壮 and ， share cue 0 (2 chars), 丽 is cue 1: one char per unit.
    expect(wipe).toEqual({
      unitOffset: [0, 1, 2],
      unitWidth: [1, 1, 1],
      cueStart: [0, 2],
      cueChars: [2, 1],
    })
    // spread: true changes none of the fields the wipe reads.
    expect(wipe).toEqual(computeWipeLayout(units, 2))
    // Front a quarter into cue 0 (char 0.5): 壮 half wiped, ， not started.
    expect(unitWipePct(0.5, 0, wipe)).toBe(50)
    expect(unitWipePct(0.5, 1, wipe)).toBe(0)
    // Three quarters in (char 1.5): 壮 done, ， half wiped.
    expect(unitWipePct(1.5, 0, wipe)).toBe(100)
    expect(unitWipePct(1.5, 1, wipe)).toBe(50)
  })
})
