import { describe, expect, it } from 'vitest'
import type { RubyPart } from '@/types/furigana'
import { type AlignToken, type TokenizerLike, alignLine } from './align'
import { isNonSplittable } from './jmdictFurigana'

// Fixture stand-in for jmdict-furigana lookup — keyed like the real index.
const FIX: Record<string, RubyPart[]> = {
  '東京\u0000とうきょう': [
    { ruby: '東', rt: 'とう' },
    { ruby: '京', rt: 'きょう' },
  ],
  '食べる\u0000たべる': [{ ruby: '食', rt: 'た' }, { ruby: 'べる' }],
  '大人\u0000おとな': [{ ruby: '大人', rt: 'おとな' }],
  '今日\u0000きょう': [{ ruby: '今日', rt: 'きょう' }],
}
const fixtureLookup = (s: string, r: string): RubyPart[] | undefined =>
  FIX[`${s}\u0000${r}`]

// Fake tokenizer: returns preset tokens regardless of input (each test aligns
// one line). A real @patdx/kuromoji tokenizer structurally satisfies this.
function fakeTokenizer(tokens: AlignToken[]): TokenizerLike {
  return { tokenize: () => tokens }
}

const deps = { lookup: fixtureLookup, isNonSplittable }

describe('alignLine', () => {
  it('aligns a per-kanji compound (東京) with context readings', () => {
    const m = alignLine(
      '東京',
      fakeTokenizer([{ surface_form: '東京', reading: 'トウキョウ' }]),
      deps,
    )
    const seg = m.segments.find((s) => s.kana === 'とうきょう')
    expect(seg?.nonSplittable).toBe(false)
    expect(seg?.perKanji?.map((p) => p.kana)).toEqual(['とう', 'きょう'])
    expect(seg?.perKanji?.[0]).toMatchObject({ charStart: 0, charEnd: 0 })
    expect(seg?.perKanji?.[1]).toMatchObject({ charStart: 1, charEnd: 1 })
  })

  it('uses the tokenizer reading for context (今日 -> きょう, jukujikun)', () => {
    const m = alignLine(
      '今日',
      fakeTokenizer([{ surface_form: '今日', reading: 'キョウ' }]),
      deps,
    )
    expect(m.segments).toEqual([
      { charStart: 0, charEnd: 1, kana: 'きょう', nonSplittable: true },
    ])
  })

  it('annotates only the kanji in 食べる; okurigana stays bare', () => {
    const m = alignLine(
      '食べる',
      fakeTokenizer([{ surface_form: '食べる', reading: 'タベル' }]),
      deps,
    )
    const kanjiSeg = m.segments.find((s) => s.kana === 'た')
    expect(kanjiSeg).toMatchObject({
      charStart: 0,
      charEnd: 0,
      nonSplittable: false,
    })
    expect(kanjiSeg?.perKanji).toEqual([{ charStart: 0, charEnd: 0, kana: 'た' }])
    const bare = m.segments.find((s) => s.charStart === 1)
    expect(bare).toMatchObject({ charStart: 1, charEnd: 2 })
    expect(bare?.kana).toBeUndefined()
  })

  it('keeps a jukujikun (大人) as one non-splittable segment', () => {
    const m = alignLine(
      '大人',
      fakeTokenizer([{ surface_form: '大人', reading: 'オトナ' }]),
      deps,
    )
    expect(m.segments).toEqual([
      { charStart: 0, charEnd: 1, kana: 'おとな', nonSplittable: true },
    ])
  })

  it('falls back to even distribution for OOV kanji (no throw)', () => {
    const m = alignLine(
      '山川',
      fakeTokenizer([{ surface_form: '山川', reading: 'ヤマカワ' }]),
      deps,
    )
    expect(m.segments).toEqual([
      { charStart: 0, charEnd: 1, kana: 'やまかわ', nonSplittable: true },
    ])
  })

  it('emits no ruby for a katakana-only line', () => {
    const m = alignLine(
      'カタカナ',
      fakeTokenizer([{ surface_form: 'カタカナ', reading: 'カタカナ' }]),
      deps,
    )
    expect(m.segments.every((s) => s.kana === undefined)).toBe(true)
  })

  it('covers the whole line in order without gaps (mixed 今日は)', () => {
    const line = '今日は'
    const m = alignLine(
      line,
      fakeTokenizer([
        { surface_form: '今日', reading: 'キョウ' },
        { surface_form: 'は', reading: 'ハ' },
      ]),
      deps,
    )
    let cursor = 0
    for (const s of m.segments) {
      expect(s.charStart).toBe(cursor)
      cursor = s.charEnd + 1
    }
    expect(cursor).toBe(line.length)
    expect(m.segments[0]).toMatchObject({
      charStart: 0,
      charEnd: 1,
      kana: 'きょう',
    })
    expect(m.segments[1]?.kana).toBeUndefined()
  })

  it('leaves kanji bare when the token has no reading', () => {
    const m = alignLine(
      '山',
      fakeTokenizer([{ surface_form: '山', reading: '*' }]),
      deps,
    )
    expect(m.segments.every((s) => s.kana === undefined)).toBe(true)
  })
})
