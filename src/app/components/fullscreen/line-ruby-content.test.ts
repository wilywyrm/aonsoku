import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RubyLineModel } from '@/types/furigana'
import { LineRubyContent } from './line-ruby-content'

// Segment/perKanji charStart/charEnd are INCLUSIVE-end (alignLine ground truth,
// align.test.ts:61-72): a single kanji is {k, k}, a two-kanji group is {0, 1}.

describe('LineRubyContent', () => {
  describe('splittable kanji segment', () => {
    it('renders ruby-unit with ruby-base and ruby-furi-rt for per-kanji cells', () => {
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
      const html = renderToStaticMarkup(
        createElement(LineRubyContent, { text, model }),
      )

      expect(html).toContain('class="ruby-unit"')
      expect(html).toContain('class="ruby-base"')
      expect(html).toContain('class="ruby-furi-rt"')
      expect(html).toContain('aria-hidden="true"')
      expect(html).toContain('なつ')
      expect(html).toContain('data-testid="line-ruby-unit"')
    })

    it('renders ruby-furi-gap for okurigana gaps', () => {
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
      const html = renderToStaticMarkup(
        createElement(LineRubyContent, { text, model }),
      )

      expect(html).toContain('class="ruby-furi-gap"')
      expect(html).toContain('class="ruby-furi-cell"')
      expect(html).toContain('class="ruby-furi-spacer"')
    })
  })

  describe('jukujikun (nonSplittable)', () => {
    it('renders one ruby-furi-cell for the whole group without tiling', () => {
      const text = '今日は晴れ'
      const model: RubyLineModel = {
        segments: [
          { charStart: 0, charEnd: 1, kana: 'きょう', nonSplittable: true },
        ],
      }
      const html = renderToStaticMarkup(
        createElement(LineRubyContent, { text, model }),
      )

      expect(html).toContain('class="ruby-unit"')
      expect(html).toContain('class="ruby-furi-cell"')
      expect(html).toContain('きょう')
      // Should NOT have ruby-furi-gap (no cells tiling)
      expect(html).not.toContain('ruby-furi-gap')
    })
  })

  describe('no model (undefined)', () => {
    it('renders plain text without ruby classes', () => {
      const text = '君の名前'
      const html = renderToStaticMarkup(
        createElement(LineRubyContent, { text, model: undefined }),
      )

      expect(html).toBe('君の名前')
      expect(html).not.toContain('ruby-unit')
      expect(html).not.toContain('ruby-base')
      expect(html).not.toContain('ruby-furi')
    })
  })

  describe('empty text', () => {
    it('renders without throwing', () => {
      const html = renderToStaticMarkup(
        createElement(LineRubyContent, { text: '', model: undefined }),
      )

      expect(html).toBe('')
      expect(html).not.toContain('ruby-')
    })
  })

  describe('forbidden attributes', () => {
    it('does not contain karaoke-fill class', () => {
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
      const html = renderToStaticMarkup(
        createElement(LineRubyContent, { text, model }),
      )

      expect(html).not.toContain('karaoke-fill')
    })

    it('does not contain --fill style variable', () => {
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
      const html = renderToStaticMarkup(
        createElement(LineRubyContent, { text, model }),
      )

      expect(html).not.toContain('--fill')
    })

    it('does not contain data-state attribute', () => {
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
      const html = renderToStaticMarkup(
        createElement(LineRubyContent, { text, model }),
      )

      expect(html).not.toContain('data-state')
    })
  })
})
