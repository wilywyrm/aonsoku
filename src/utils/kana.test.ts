import { describe, expect, it } from 'vitest'
import { hasKanji, isKanji, katakanaToHiragana, segmentScriptRuns } from './kana'

describe('kana utilities', () => {
  describe('katakanaToHiragana', () => {
    it('converts basic katakana to hiragana', () => {
      expect(katakanaToHiragana('タベル')).toBe('たべる')
    })

    it('converts full katakana string', () => {
      expect(katakanaToHiragana('トウキョウ')).toBe('とうきょう')
    })

    it('handles special case ヴ → ゔ', () => {
      expect(katakanaToHiragana('ヴ')).toBe('ゔ')
    })

    it('keeps prolonged sound mark ー as-is', () => {
      expect(katakanaToHiragana('ー')).toBe('ー')
    })

    it('handles mixed katakana and non-katakana', () => {
      expect(katakanaToHiragana('カタカナ123')).toBe('かたかな123')
    })

    it('handles small katakana', () => {
      expect(katakanaToHiragana('ァィゥェォ')).toBe('ぁぃぅぇぉ')
    })
  })

  describe('isKanji', () => {
    it('recognizes CJK Unified Ideographs', () => {
      expect(isKanji(0x4e00)).toBe(true)
      expect(isKanji(0x9fff)).toBe(true)
    })

    it('recognizes CJK Extension A', () => {
      expect(isKanji(0x3400)).toBe(true)
      expect(isKanji(0x4dbf)).toBe(true)
    })

    it('recognizes CJK Extension B (surrogate pair range)', () => {
      expect(isKanji(0x20000)).toBe(true)
      expect(isKanji(0x2a6df)).toBe(true)
    })

    it('recognizes CJK Compatibility Ideographs', () => {
      expect(isKanji(0xf900)).toBe(true)
      expect(isKanji(0xfaff)).toBe(true)
    })

    it('rejects non-kanji code points', () => {
      expect(isKanji(0x3042)).toBe(false) // あ (hiragana)
      expect(isKanji(0x30a2)).toBe(false) // ア (katakana)
      expect(isKanji(0x0061)).toBe(false) // a (ASCII)
    })

    it('recognizes ideographic iteration marks', () => {
      expect(isKanji(0x3005)).toBe(true) // 々
      expect(isKanji(0x303b)).toBe(true) // 〻
    })
  })

  describe('segmentScriptRuns', () => {
    it('segments kanji and hiragana correctly', () => {
      expect(segmentScriptRuns('食べる')).toEqual([
        { kind: 'kanji', charStart: 0, charEnd: 0 },
        { kind: 'other', charStart: 1, charEnd: 2 },
      ])
    })

    it('segments mixed kanji and hiragana', () => {
      expect(segmentScriptRuns('食べる東京')).toEqual([
        { kind: 'kanji', charStart: 0, charEnd: 0 },
        { kind: 'other', charStart: 1, charEnd: 2 },
        { kind: 'kanji', charStart: 3, charEnd: 4 },
      ])
    })

    it('handles all non-kanji characters', () => {
      expect(segmentScriptRuns('abc123')).toEqual([
        { kind: 'other', charStart: 0, charEnd: 5 },
      ])
    })

    it('handles katakana as non-kanji', () => {
      expect(segmentScriptRuns('カタカナ')).toEqual([
        { kind: 'other', charStart: 0, charEnd: 3 },
      ])
    })

    it('handles consecutive kanji', () => {
      expect(segmentScriptRuns('漢字')).toEqual([
        { kind: 'kanji', charStart: 0, charEnd: 1 },
      ])
    })

    it('treats the 々 iteration mark as part of a kanji run', () => {
      expect(segmentScriptRuns('人々')).toEqual([
        { kind: 'kanji', charStart: 0, charEnd: 1 },
      ])
    })

    it('handles empty string', () => {
      expect(segmentScriptRuns('')).toEqual([])
    })
  })

  describe('hasKanji', () => {
    it('returns true for lines with kanji', () => {
      expect(hasKanji('食べる')).toBe(true)
      expect(hasKanji('東京')).toBe(true)
    })

    it('returns false for katakana-only lines', () => {
      expect(hasKanji('カタカナだけ')).toBe(false)
    })

    it('returns false for hiragana-only lines', () => {
      expect(hasKanji('ひらがなだけ')).toBe(false)
    })

    it('returns false for ASCII-only lines', () => {
      expect(hasKanji('abc123')).toBe(false)
    })

    it('returns true for mixed content with kanji', () => {
      expect(hasKanji('漢字とひらがな')).toBe(true)
    })

    it('handles empty string', () => {
      expect(hasKanji('')).toBe(false)
    })
  })
})
