import type { RubyPart } from '@/types/furigana'
import { buildIndex, isNonSplittable, load, lookup } from './jmdictFurigana'

// Small inline stand-in for the 33 MB public/dict/JmdictFurigana.json. The real
// file MUST NOT be fetched here: a dozen-MB request behind the Cypress proxy is
// pathologically slow, so every test drives these entries instead.
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
  describe('buildIndex', () => {
    it('indexes every entry keyed by (text, reading)', () => {
      const index = buildIndex(FIXTURE)
      expect(index.size).to.equal(FIXTURE.length)
      expect(index.get('東京\u0000とうきょう')).to.deep.equal([
        { ruby: '東', rt: 'とう' },
        { ruby: '京', rt: 'きょう' },
      ])
    })

    it('separates homographs by reading via the NUL-joined key', () => {
      const index = buildIndex(FIXTURE)
      expect(index.has('東京\u0000とうきょう')).to.be.true
      // Same surface, different reading is a distinct (absent) key.
      expect(index.has('東京\u0000とうきよう')).to.be.false
    })

    it('preserves bare (rt-less) okurigana parts', () => {
      const index = buildIndex(FIXTURE)
      expect(index.get('食べる\u0000たべる')).to.deep.equal([
        { ruby: '食', rt: 'た' },
        { ruby: 'べる' },
      ])
    })

    it('returns an empty map for no entries', () => {
      expect(buildIndex([]).size).to.equal(0)
    })
  })

  describe('isNonSplittable', () => {
    it('is false when each rt spans a single kanji (東京)', () => {
      const parts = buildIndex(FIXTURE).get('東京\u0000とうきょう')!
      expect(isNonSplittable(parts)).to.be.false
    })

    it('is true for a jukujikun rt spanning 2 kanji (大人)', () => {
      const parts = buildIndex(FIXTURE).get('大人\u0000おとな')!
      expect(isNonSplittable(parts)).to.be.true
    })

    it('is true for a jukujikun rt spanning 2 kanji (今日)', () => {
      const parts = buildIndex(FIXTURE).get('今日\u0000きょう')!
      expect(isNonSplittable(parts)).to.be.true
    })

    it('is false when a bare part follows a single-kanji rt (食べる)', () => {
      const parts = buildIndex(FIXTURE).get('食べる\u0000たべる')!
      expect(isNonSplittable(parts)).to.be.false
    })

    it('is false for a per-kanji multi-kanji reading (日本語)', () => {
      const parts = buildIndex(FIXTURE).get('日本語\u0000にほんご')!
      expect(isNonSplittable(parts)).to.be.false
    })

    it('is false when no part carries an rt', () => {
      expect(isNonSplittable([{ ruby: 'べる' }])).to.be.false
    })

    it('ignores >=2 kanji when they carry no rt', () => {
      expect(isNonSplittable([{ ruby: '大人' }])).to.be.false
    })
  })

  describe('lookup', () => {
    it('returns undefined before load() resolves', () => {
      expect(lookup('東京', 'とうきょう')).to.be.undefined
    })

    it('returns cached parts after load() with a stubbed fetch', () => {
      // Stub the network so load() parses the inline fixture, never the real
      // 33 MB file. cy.stub runs synchronously, so the awaited load() below
      // observes it immediately.
      cy.stub(window, 'fetch').resolves(
        new Response(JSON.stringify(FIXTURE), { status: 200 }),
      )

      return load().then((index) => {
        expect(index.size).to.equal(FIXTURE.length)
        expect(lookup('東京', 'とうきょう')).to.deep.equal([
          { ruby: '東', rt: 'とう' },
          { ruby: '京', rt: 'きょう' },
        ])
        expect(lookup('大人', 'おとな')).to.deep.equal([
          { ruby: '大人', rt: 'おとな' },
        ])
        // Miss on unknown surface and on wrong reading both fall back.
        expect(lookup('京都', 'きょうと')).to.be.undefined
        expect(lookup('東京', 'とうきよう')).to.be.undefined
      })
    })
  })
})
