import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RubyPart } from '@/types/furigana'
import { buildIndex, isNonSplittable, load, lookup } from './jmdictFurigana'

// Small inline stand-in for the 33 MB public/dict/JmdictFurigana.json. The real
// file MUST NOT be fetched here — dictionary-dependent logic is unit-tested with
// this fixture instead (see vitest.config.ts).
interface RawEntry {
  text: string
  reading: string
  furigana: RubyPart[]
}

const FIXTURE: RawEntry[] = [
  {
    text: '東京',
    reading: 'とうきょう',
    furigana: [
      { ruby: '東', rt: 'とう' },
      { ruby: '京', rt: 'きょう' },
    ],
  },
  {
    text: '食べる',
    reading: 'たべる',
    furigana: [{ ruby: '食', rt: 'た' }, { ruby: 'べる' }],
  },
  {
    text: '大人',
    reading: 'おとな',
    furigana: [{ ruby: '大人', rt: 'おとな' }],
  },
  {
    text: '今日',
    reading: 'きょう',
    furigana: [{ ruby: '今日', rt: 'きょう' }],
  },
  {
    text: '日本語',
    reading: 'にほんご',
    furigana: [
      { ruby: '日', rt: 'に' },
      { ruby: '本', rt: 'ほん' },
      { ruby: '語', rt: 'ご' },
    ],
  },
  {
    text: '時計',
    reading: 'とけい',
    furigana: [
      { ruby: '時', rt: 'と' },
      { ruby: '計', rt: 'けい' },
    ],
  },
]

describe('jmdictFurigana', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('buildIndex', () => {
    it('indexes every entry keyed by (text, reading)', () => {
      const index = buildIndex(FIXTURE)
      expect(index.size).toBe(FIXTURE.length)
      expect(index.get('東京\u0000とうきょう')).toEqual([
        { ruby: '東', rt: 'とう' },
        { ruby: '京', rt: 'きょう' },
      ])
    })

    it('separates homographs by reading via the NUL-joined key', () => {
      const index = buildIndex(FIXTURE)
      expect(index.has('東京\u0000とうきょう')).toBe(true)
      expect(index.has('東京\u0000とうきよう')).toBe(false)
    })

    it('preserves bare (rt-less) okurigana parts', () => {
      const index = buildIndex(FIXTURE)
      expect(index.get('食べる\u0000たべる')).toEqual([
        { ruby: '食', rt: 'た' },
        { ruby: 'べる' },
      ])
    })

    it('returns an empty map for no entries', () => {
      expect(buildIndex([]).size).toBe(0)
    })
  })

  describe('isNonSplittable', () => {
    it('is false when each rt spans a single kanji (東京)', () => {
      const parts = buildIndex(FIXTURE).get('東京\u0000とうきょう')!
      expect(isNonSplittable(parts)).toBe(false)
    })

    it('is true for a jukujikun rt spanning 2 kanji (大人)', () => {
      const parts = buildIndex(FIXTURE).get('大人\u0000おとな')!
      expect(isNonSplittable(parts)).toBe(true)
    })

    it('is true for a jukujikun rt spanning 2 kanji (今日)', () => {
      const parts = buildIndex(FIXTURE).get('今日\u0000きょう')!
      expect(isNonSplittable(parts)).toBe(true)
    })

    it('is false when a bare part follows a single-kanji rt (食べる)', () => {
      const parts = buildIndex(FIXTURE).get('食べる\u0000たべる')!
      expect(isNonSplittable(parts)).toBe(false)
    })

    it('is false for a per-kanji multi-kanji reading (日本語)', () => {
      const parts = buildIndex(FIXTURE).get('日本語\u0000にほんご')!
      expect(isNonSplittable(parts)).toBe(false)
    })

    it('is false when no part carries an rt', () => {
      expect(isNonSplittable([{ ruby: 'べる' }])).toBe(false)
    })

    it('ignores >=2 kanji when they carry no rt', () => {
      expect(isNonSplittable([{ ruby: '大人' }])).toBe(false)
    })
  })

  describe('lookup', () => {
    it('returns undefined before load() resolves', () => {
      expect(lookup('東京', 'とうきょう')).toBeUndefined()
    })

    it('returns cached parts after load() with a stubbed fetch', async () => {
      // Stub the network so load() parses the inline fixture, never the real
      // 33 MB file.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(FIXTURE), { status: 200 }),
        ),
      )

      const index = await load()
      expect(index.size).toBe(FIXTURE.length)
      expect(lookup('東京', 'とうきょう')).toEqual([
        { ruby: '東', rt: 'とう' },
        { ruby: '京', rt: 'きょう' },
      ])
      expect(lookup('大人', 'おとな')).toEqual([{ ruby: '大人', rt: 'おとな' }])
      // Miss on unknown surface and on wrong reading both fall back.
      expect(lookup('京都', 'きょうと')).toBeUndefined()
      expect(lookup('東京', 'とうきよう')).toBeUndefined()
    })
  })
})
