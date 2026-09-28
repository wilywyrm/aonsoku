// ============================================================================
// FROZEN SNAPSHOTS: NEVER run `vitest -u` on this file, nor on a suite run that
// includes it. These inline snapshots were written exactly ONCE, when the file
// was created, and pin the Japanese furigana markup of the real pipeline
// (alignPronunciation -> reconcile -> resolveUnitLayout -> RubyCueContent, and
// alignPronunciation -> LineRubyContent) as it was before pinyin spread mode.
// A mismatch means Japanese ruby output changed: fix the code, not the snapshot.
// ============================================================================
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { alignPronunciation } from '@/service/furigana/alignPronunciation'
import { resolveUnitLayout } from '@/service/furigana/layout'
import { reconcile } from '@/service/furigana/reconcile'
import type { RubyLineModel } from '@/types/furigana'
import type {
  NormalizedCue,
  NormalizedStructuredLyric,
} from '@/utils/wordTiming'
import { LineRubyContent } from './line-ruby-content'
import { RubyCueContent } from './word-level-lyrics/ruby-cue-content'

// One-line track shaped like a lyricsfile payload: the line value is the cue
// values in order, and byte offsets run over it with an INCLUSIVE byteEnd
// (reconcile treats an exclusive one as malformed and drops the ruby). Each cue
// keeps its own explicit end; none is derived.
function makeTrack(
  cues: Array<{ value: string; start: number; end: number }>,
): NormalizedStructuredLyric {
  let running = 0
  const timed: NormalizedCue[] = cues.map(({ value, start, end }) => {
    const len = new TextEncoder().encode(value).length
    const byteStart = running
    const byteEnd = running + len - 1
    running += len
    return { start, end, value, byteStart, byteEnd }
  })
  const value = cues.map((c) => c.value).join('')
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

function countReadings(markup: string): number {
  return markup.split('class="ruby-furi-rt"').length - 1
}

function renderLine(text: string, model: RubyLineModel): string {
  return renderToStaticMarkup(<LineRubyContent text={text} model={model} />)
}

describe('Japanese ruby markup (frozen before pinyin spread mode)', () => {
  it('word-level: 妄想戦上のルーティン from real cue data (E1)', () => {
    const starts = [
      101881, 102183, 102729, 102910, 103052, 103254, 103436, 103577, 103637,
      103799,
    ]
    const ends = [
      102183, 102729, 102910, 103052, 103254, 103436, 103577, 103637, 103799,
      103900,
    ]
    const timed = (values: string[]) =>
      values.map((value, i) => ({ value, start: starts[i], end: ends[i] }))
    const main = makeTrack(timed([...'妄想戦上のルーティン']))
    const pron = makeTrack(
      timed(['もう', 'そう', 'せん', 'じょう', ...'のルーティン']),
    )
    const cueLine = main.lines[0].cueLines[0]

    // What the word-level container computes for this cueLine.
    const [model] = alignPronunciation(main, pron)
    const layout = resolveUnitLayout(
      reconcile(model, cueLine.cues, cueLine.value),
      cueLine.value,
    )
    const markup = renderToStaticMarkup(
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

    // Exactly 4 class="ruby-furi-rt" readings, one per kanji: a byte-offset
    // slip silently renders none.
    expect(countReadings(markup)).toBe(4)
    for (const kana of ['もう', 'そう', 'せん', 'じょう']) {
      expect(markup).toContain(`>${kana}</span>`)
    }
    expect(markup).toMatchInlineSnapshot(
      `"<span data-testid="word-unit-0-0:pos0-0-0" data-state="future" class="cursor-pointer hover:opacity-100 [word-break:keep-all] opacity-50" tabindex="0"><span class="ruby-unit"><span class="ruby-base">妄</span><span class="ruby-furi" aria-hidden="true"><span class="ruby-furi-cell"><span class="ruby-furi-spacer">妄</span><span class="ruby-furi-rt" style="--seg-start:0%;--seg-span:1">もう</span></span></span></span></span><span data-testid="word-unit-0-0:pos0-1-1" data-state="future" class="cursor-pointer hover:opacity-100 [word-break:keep-all] opacity-50" tabindex="0"><span class="ruby-unit"><span class="ruby-base">想</span><span class="ruby-furi" aria-hidden="true"><span class="ruby-furi-cell"><span class="ruby-furi-spacer">想</span><span class="ruby-furi-rt" style="--seg-start:0%;--seg-span:1">そう</span></span></span></span></span><span data-testid="word-unit-0-0:pos0-2-2" data-state="future" class="cursor-pointer hover:opacity-100 [word-break:keep-all] opacity-50" tabindex="0"><span class="ruby-unit"><span class="ruby-base">戦</span><span class="ruby-furi" aria-hidden="true"><span class="ruby-furi-cell"><span class="ruby-furi-spacer">戦</span><span class="ruby-furi-rt" style="--seg-start:0%;--seg-span:1">せん</span></span></span></span></span><span data-testid="word-unit-0-0:pos0-3-3" data-state="future" class="cursor-pointer hover:opacity-100 [word-break:keep-all] opacity-50" tabindex="0"><span class="ruby-unit"><span class="ruby-base">上</span><span class="ruby-furi" aria-hidden="true"><span class="ruby-furi-cell"><span class="ruby-furi-spacer">上</span><span class="ruby-furi-rt" style="--seg-start:0%;--seg-span:1;--rt-shift:0.5em">じょう</span></span></span></span></span><span data-testid="word-unit-0-0:pos0-4-4" data-state="future" class="cursor-pointer hover:opacity-100 [word-break:keep-all] opacity-50" tabindex="0">の</span><span data-testid="word-unit-0-0:pos0-5-5" data-state="future" class="cursor-pointer hover:opacity-100 [word-break:keep-all] opacity-50" tabindex="0">ル</span><span data-testid="word-unit-0-0:pos0-6-6" data-state="future" class="cursor-pointer hover:opacity-100 [word-break:keep-all] opacity-50" tabindex="0">ー</span><span data-testid="word-unit-0-0:pos0-7-7" data-state="future" class="cursor-pointer hover:opacity-100 [word-break:keep-all] opacity-50" tabindex="0">テ</span><span data-testid="word-unit-0-0:pos0-8-8" data-state="future" class="cursor-pointer hover:opacity-100 [word-break:keep-all] opacity-50" tabindex="0">ィ</span><span data-testid="word-unit-0-0:pos0-9-9" data-state="future" class="cursor-pointer hover:opacity-100 [word-break:keep-all] opacity-50" tabindex="0">ン</span>"`,
    )
  })

  it('line-level: 少々出来すぎ shifts で instead of merging (E6)', () => {
    const model: RubyLineModel = {
      segments: [
        {
          charStart: 0,
          charEnd: 1,
          kana: 'しょうしょう',
          nonSplittable: false,
          perKanji: [
            { charStart: 0, charEnd: 0, kana: 'しょう' },
            { charStart: 1, charEnd: 1, kana: 'しょう' },
          ],
        },
        {
          charStart: 2,
          charEnd: 3,
          kana: 'でき',
          nonSplittable: false,
          perKanji: [
            { charStart: 2, charEnd: 2, kana: 'で' },
            { charStart: 3, charEnd: 3, kana: 'き' },
          ],
        },
      ],
    }
    const markup = renderLine('少々出来すぎ', model)

    expect(countReadings(markup)).toBe(3)
    expect(markup).toMatchInlineSnapshot(
      `"<p><span class="ruby-unit ruby-static" data-testid="line-ruby-unit"><span class="ruby-base">少々</span><span class="ruby-furi" aria-hidden="true"><span class="ruby-furi-cell"><span class="ruby-furi-spacer">少々</span><span class="ruby-furi-rt">しょうしょう</span></span></span></span><span class="ruby-unit ruby-static" data-testid="line-ruby-unit"><span class="ruby-base">出来</span><span class="ruby-furi" aria-hidden="true"><span class="ruby-furi-cell"><span class="ruby-furi-spacer">出</span><span class="ruby-furi-rt" style="--rt-shift:0.5em">で</span></span><span class="ruby-furi-cell"><span class="ruby-furi-spacer">来</span><span class="ruby-furi-rt">き</span></span></span></span>すぎ</p>"`,
    )
  })

  it('line-level: 今日は — jukujikun group ruby, bare particle', () => {
    const main = makeTrack([
      { value: '今日', start: 0, end: 400 },
      { value: 'は', start: 400, end: 600 },
    ])
    const pron = makeTrack([
      { value: 'きょう', start: 0, end: 400 },
      { value: 'は', start: 400, end: 600 },
    ])
    const [model] = alignPronunciation(main, pron)
    const markup = renderLine(main.lines[0].value, model)

    expect(countReadings(markup)).toBe(1)
    expect(markup).toMatchInlineSnapshot(
      `"<p><span class="ruby-unit ruby-static" data-testid="line-ruby-unit"><span class="ruby-base">今日</span><span class="ruby-furi" aria-hidden="true"><span class="ruby-furi-cell"><span class="ruby-furi-spacer">今日</span><span class="ruby-furi-rt">きょう</span></span></span></span>は</p>"`,
    )
  })

  it('line-level: 珈琲 edge space stays under the katakana reading コーヒー', () => {
    // Trailing-space cue convention (like `你 ` + `ba` in the ZH fixtures); the
    // English word carries no pron cue. Kana readings keep today's affix
    // stripping, which leaves the space inside the ruby base.
    const main = makeTrack([
      { value: '珈琲 ', start: 0, end: 500 },
      { value: 'break', start: 500, end: 900 },
    ])
    const pron = makeTrack([{ value: 'コーヒー', start: 0, end: 500 }])
    const [model] = alignPronunciation(main, pron)
    const markup = renderLine(main.lines[0].value, model)

    expect(countReadings(markup)).toBe(1)
    expect(markup).toContain('<span class="ruby-base">珈琲 </span>')
    expect(markup).toMatchInlineSnapshot(
      `"<p><span class="ruby-unit ruby-static" data-testid="line-ruby-unit"><span class="ruby-base">珈琲 </span><span class="ruby-furi" aria-hidden="true"><span class="ruby-furi-cell"><span class="ruby-furi-spacer">珈琲 </span><span class="ruby-furi-rt">コーヒー</span></span></span></span>break</p>"`,
    )
  })
})
