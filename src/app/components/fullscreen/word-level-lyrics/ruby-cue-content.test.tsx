import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReadingGroup } from '@/service/furigana/grouping'
import type { RenderUnit } from '@/types/furigana'
import type { NormalizedCueLine } from '@/utils/wordTiming'
import { RubyCueContent } from './ruby-cue-content'

// E1, the line that exposed the collision bug: four single-kanji ruby units,
// then six bare units, each on its own cue.
const TEXT = '妄想戦上のルーティン'

function rubyUnit(i: number, kanjiText: string, kana: string): RenderUnit {
  return {
    charStart: i,
    charEnd: i,
    kanjiText,
    kana,
    nonSplittable: true,
    coveringCueIdx: [i],
    cueCharCounts: [1],
  }
}

function bareUnit(i: number, kanjiText: string): RenderUnit {
  return {
    charStart: i,
    charEnd: i,
    kanjiText,
    kana: undefined,
    nonSplittable: false,
    coveringCueIdx: [i],
    cueCharCounts: [1],
  }
}

const units: RenderUnit[] = [
  rubyUnit(0, '妄', 'もう'),
  rubyUnit(1, '想', 'そう'),
  rubyUnit(2, '戦', 'せん'),
  rubyUnit(3, '上', 'じょう'),
  bareUnit(4, 'の'),
  bareUnit(5, 'ル'),
  bareUnit(6, 'ー'),
  bareUnit(7, 'テ'),
  bareUnit(8, 'ィ'),
  bareUnit(9, 'ン'),
]

// RubyCueContent only reads a cue's `start` (click-to-seek), so the cues carry
// no byte offsets.
const cueLine: NormalizedCueLine = {
  lineIndex: 0,
  key: '0:lead',
  displayOrder: 0,
  start: 101881,
  end: 103900,
  value: TEXT,
  cues: [
    { start: 101881, end: 102183, value: '妄' },
    { start: 102183, end: 102729, value: '想' },
    { start: 102729, end: 102910, value: '戦' },
    { start: 102910, end: 103052, value: '上' },
    { start: 103052, end: 103254, value: 'の' },
    { start: 103254, end: 103436, value: 'ル' },
    { start: 103436, end: 103577, value: 'ー' },
    { start: 103577, end: 103637, value: 'テ' },
    { start: 103637, end: 103799, value: 'ィ' },
    { start: 103799, end: 103900, value: 'ン' },
  ],
}

// Hand-written, not resolved: the component must draw exactly these.
const groups: ReadingGroup[][] = [
  [{ start: 0, end: 0, kana: 'もう' }],
  [{ start: 0, end: 0, kana: 'そう' }],
  [{ start: 0, end: 0, kana: 'せん' }],
  [{ start: 0, end: 0, kana: 'じょう', shift: 0.25 }],
  [],
  [],
  [],
  [],
  [],
  [],
]

function render(groups: ReadingGroup[][]): string {
  return renderToStaticMarkup(
    <RubyCueContent
      units={units}
      groups={groups}
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

function countReadings(markup: string): number {
  return markup.split('class="ruby-furi-rt"').length - 1
}

describe('RubyCueContent', () => {
  it('renders the provided groups: じょう carries --rt-shift:0.5em', () => {
    const markup = render(groups)

    expect(countReadings(markup)).toBe(4)
    // shift is in base-em; segStyle divides by RT_EM (0.5): 0.25 -> 0.5em.
    expect(markup).toContain(
      'style="--seg-start:0%;--seg-span:1;--rt-shift:0.5em">じょう</span>',
    )
    expect(markup).toContain('style="--seg-start:0%;--seg-span:1">もう</span>')
  })

  it('uses groups verbatim (no recomputation)', () => {
    const verbatim: ReadingGroup[][] = [
      [{ start: 0, end: 0, kana: 'もう', tracking: -0.15, shift: -0.1 }],
      [{ start: 0, end: 0, kana: 'そう' }],
      [{ start: 0, end: 0, kana: 'せん' }],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
    ]
    const markup = render(verbatim)

    expect(markup).toContain('--rt-tracking:-0.15em')
    expect(markup).toContain('--rt-shift:-0.2em')
    expect(markup).toContain(
      'style="--seg-start:0%;--seg-span:1;--rt-tracking:-0.15em;--rt-shift:-0.2em">もう</span>',
    )
    expect(countReadings(markup)).toBe(3)
    // 上 still has kana, but its reading was dropped upstream: nothing re-derives it.
    expect(markup).not.toContain('じょう')
  })

  it('does not mutate groups', () => {
    const before = structuredClone(groups)

    render(groups)

    expect(groups).toEqual(before)
  })
})
