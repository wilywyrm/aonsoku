import { describe, expect, it } from 'vitest'
import type { RubyPart } from '@/types/furigana'
import type { NormalizedCue } from '@/utils/wordTiming'
import { type AlignToken, type TokenizerLike, alignLine } from './align'
import { isNonSplittable } from './jmdictFurigana'
import { reconcile } from './reconcile'

// Fixture stand-in for jmdict-furigana lookup — keyed like the real index.
const FIX: Record<string, RubyPart[]> = {
  '東京\u0000とうきょう': [
    { ruby: '東', rt: 'とう' },
    { ruby: '京', rt: 'きょう' },
  ],
  '食べる\u0000たべる': [{ ruby: '食', rt: 'た' }, { ruby: 'べる' }],
  '大人\u0000おとな': [{ ruby: '大人', rt: 'おとな' }],
  '今日\u0000きょう': [{ ruby: '今日', rt: 'きょう' }],
  '見送る\u0000みおくる': [
    { ruby: '見', rt: 'み' },
    { ruby: '送', rt: 'おく' },
    { ruby: 'る' },
  ],
  '来る\u0000くる': [{ ruby: '来', rt: 'く' }, { ruby: 'る' }],
  '遊び\u0000あそび': [{ ruby: '遊', rt: 'あそ' }, { ruby: 'び' }],
}
const fixtureLookup = (s: string, r: string): RubyPart[] | undefined =>
  FIX[`${s}\u0000${r}`]

const FIX_SURFACE: Record<string, RubyPart[][]> = {
  魔眼: [[{ ruby: '魔', rt: 'ま' }, { ruby: '眼', rt: 'がん' }]],
  大人: [
    [{ ruby: '大人', rt: 'おとな' }],
    [{ ruby: '大', rt: 'だい' }, { ruby: '人', rt: 'にん' }],
  ],
  識る: [[{ ruby: '識', rt: 'し' }, { ruby: 'る' }]],
}
const fixtureLookupBySurface = (s: string): RubyPart[][] | undefined =>
  FIX_SURFACE[s]

// Fake tokenizer: returns preset tokens regardless of input (each test aligns
// one line). A real @patdx/kuromoji tokenizer structurally satisfies this.
function fakeTokenizer(tokens: AlignToken[]): TokenizerLike {
  return { tokenize: () => tokens }
}

const deps = {
  lookup: fixtureLookup,
  lookupBySurface: fixtureLookupBySurface,
  isNonSplittable,
}

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

  it('renders 食べる as one unit spanning the okurigana (bare べる inside)', () => {
    const m = alignLine(
      '食べる',
      fakeTokenizer([{ surface_form: '食べる', reading: 'タベル' }]),
      deps,
    )
    expect(m.segments).toEqual([
      {
        charStart: 0,
        charEnd: 2,
        kana: 'た',
        nonSplittable: false,
        perKanji: [{ charStart: 0, charEnd: 0, kana: 'た' }],
      },
    ])
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

  it('splits an OOV conjugated verb into one unit, trailing okurigana bare (立った)', () => {
    const m = alignLine(
      '立った',
      fakeTokenizer([{ surface_form: '立った', reading: 'タッタ' }]),
      deps,
    )
    expect(m.segments).toEqual([
      {
        charStart: 0,
        charEnd: 2,
        kana: 'た',
        nonSplittable: false,
        perKanji: [{ charStart: 0, charEnd: 0, kana: 'た' }],
      },
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

  it('resolves a conjugated verb via its dictionary form as one unit (見送った)', () => {
    const m = alignLine(
      '見送った',
      fakeTokenizer([
        { surface_form: '見送った', reading: 'ミオクッタ', basic_form: '見送る' },
      ]),
      deps,
    )
    expect(m.segments).toEqual([
      {
        charStart: 0,
        charEnd: 3,
        kana: 'みおく',
        nonSplittable: false,
        perKanji: [
          { charStart: 0, charEnd: 0, kana: 'み' },
          { charStart: 1, charEnd: 1, kana: 'おく' },
        ],
      },
    ])
  })

  it('uses an explicit lemma reading for the dict-form lookup (UniDic-style 見送っ)', () => {
    const m = alignLine(
      '見送っ',
      fakeTokenizer([
        {
          surface_form: '見送っ',
          reading: 'ミオクル',
          basic_form: '見送る',
          lemmaReading: 'ミオクル',
        },
      ]),
      deps,
    )
    expect(m.segments).toEqual([
      {
        charStart: 0,
        charEnd: 2,
        kana: 'みおく',
        nonSplittable: false,
        perKanji: [
          { charStart: 0, charEnd: 0, kana: 'み' },
          { charStart: 1, charEnd: 1, kana: 'おく' },
        ],
      },
    ])
  })

  it('degrades an irregular stem to an OOV one-unit reading when dict-form lookup misses (来た)', () => {
    const m = alignLine(
      '来た',
      fakeTokenizer([{ surface_form: '来た', reading: 'キタ', basic_form: '来る' }]),
      deps,
    )
    expect(m.segments).toEqual([
      {
        charStart: 0,
        charEnd: 1,
        kana: 'き',
        nonSplittable: false,
        perKanji: [{ charStart: 0, charEnd: 0, kana: 'き' }],
      },
    ])
  })

  it('prefers the surface-form entry over basic_form when the surface hits', () => {
    const m = alignLine(
      '東京',
      fakeTokenizer([
        { surface_form: '東京', reading: 'トウキョウ', basic_form: '大人' },
      ]),
      deps,
    )
    expect(
      m.segments.find((s) => s.charStart === 0)?.perKanji?.map((p) => p.kana),
    ).toEqual(['とう', 'きょう'])
  })

  it('renders a kanji+okurigana word as one unit spanning the okurigana (遊び)', () => {
    const m = alignLine(
      '遊び',
      fakeTokenizer([{ surface_form: '遊び', reading: 'アソビ' }]),
      deps,
    )
    expect(m.segments).toEqual([
      {
        charStart: 0,
        charEnd: 1,
        kana: 'あそ',
        nonSplittable: false,
        perKanji: [{ charStart: 0, charEnd: 0, kana: 'あそ' }],
      },
    ])
  })

  it('splits an OOV internal-sokuon word so the sokuon stays bare (真っ赤)', () => {
    const m = alignLine(
      '真っ赤',
      fakeTokenizer([{ surface_form: '真っ赤', reading: 'マッカ' }]),
      deps,
    )
    expect(m.segments).toEqual([
      {
        charStart: 0,
        charEnd: 2,
        kana: 'まか',
        nonSplittable: false,
        perKanji: [
          { charStart: 0, charEnd: 0, kana: 'ま' },
          { charStart: 2, charEnd: 2, kana: 'か' },
        ],
      },
    ])
  })

  it('re-compounds adjacent kanji tokens into a jmdict entry (魔眼 -> まがん)', () => {
    const m = alignLine(
      '魔眼',
      fakeTokenizer([
        { surface_form: '魔', reading: 'マ' },
        { surface_form: '眼', reading: 'メ' },
      ]),
      deps,
    )
    expect(m.segments).toEqual([
      {
        charStart: 0,
        charEnd: 1,
        kana: 'まがん',
        nonSplittable: false,
        perKanji: [
          { charStart: 0, charEnd: 0, kana: 'ま' },
          { charStart: 1, charEnd: 1, kana: 'がん' },
        ],
      },
    ])
  })

  it('re-compounds by the homograph reading matching the tokenizer (大人 -> だいにん)', () => {
    const m = alignLine(
      '大人',
      fakeTokenizer([
        { surface_form: '大', reading: 'ダイ' },
        { surface_form: '人', reading: 'ニン' },
      ]),
      deps,
    )
    expect(m.segments).toEqual([
      {
        charStart: 0,
        charEnd: 1,
        kana: 'だいにん',
        nonSplittable: false,
        perKanji: [
          { charStart: 0, charEnd: 0, kana: 'だい' },
          { charStart: 1, charEnd: 1, kana: 'にん' },
        ],
      },
    ])
  })

  it('recovers an unread kanji via a jmdict surface lookup (識 + る -> 識る)', () => {
    const m = alignLine(
      '識る',
      fakeTokenizer([
        { surface_form: '識' },
        { surface_form: 'る', reading: 'ル' },
      ]),
      deps,
    )
    expect(m.segments).toEqual([
      {
        charStart: 0,
        charEnd: 1,
        kana: 'し',
        nonSplittable: false,
        perKanji: [{ charStart: 0, charEnd: 0, kana: 'し' }],
      },
    ])
  })
})

function cueFor(lineValue: string, sub: string): NormalizedCue {
  const enc = new TextEncoder()
  const idx = lineValue.indexOf(sub)
  const byteStart = enc.encode(lineValue.slice(0, idx)).length
  const byteEnd = byteStart + enc.encode(sub).length - 1
  return { start: 0, end: 1000, value: sub, byteStart, byteEnd }
}

describe('alignLine + reconcile (integration)', () => {
  it('keeps a recovered reading when 識 is its own separately-timed cue', () => {
    const model = alignLine(
      '識る',
      fakeTokenizer([
        { surface_form: '識' },
        { surface_form: 'る', reading: 'ル' },
      ]),
      deps,
    )
    const units = reconcile(
      model,
      [cueFor('識る', '識'), cueFor('識る', 'る')],
      '識る',
    )
    const ruby = units.find((u) => u.kana === 'し')
    expect(ruby?.perKanji).toEqual([{ charStart: 0, charEnd: 0, kana: 'し' }])
    expect(ruby?.coveringCueIdx).toEqual([0, 1])
  })

  it('recovers 識 in the full per-character-cued line (羽ばたきを識るウイング)', () => {
    const line = '羽ばたきを識るウイング'
    const model = alignLine(
      line,
      fakeTokenizer([
        { surface_form: '羽ばたき', reading: 'ハバタキ', basic_form: '羽ばたく' },
        { surface_form: 'を', reading: 'ヲ' },
        { surface_form: '識' },
        { surface_form: 'る', reading: 'ル' },
        { surface_form: 'ウイング', reading: 'ウイング' },
      ]),
      deps,
    )
    const cues = [...line].map((ch) => cueFor(line, ch))
    const units = reconcile(model, cues, line)
    const shiki = units.find(
      (u) => u.charStart <= 5 && u.charEnd >= 5 && u.kana === 'し',
    )
    expect(shiki).toBeDefined()
    expect(shiki?.perKanji).toContainEqual({
      charStart: 5,
      charEnd: 5,
      kana: 'し',
    })
  })
})
