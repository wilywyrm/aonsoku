import {
  katakanaToHiragana,
  isKanji,
  segmentScriptRuns,
  hasKanji,
} from './kana'

describe('kana utilities', () => {
  describe('katakanaToHiragana', () => {
    it('converts basic katakana to hiragana', () => {
      expect(katakanaToHiragana('タベル')).to.equal('たべる')
    })

    it('converts full katakana string', () => {
      expect(katakanaToHiragana('トウキョウ')).to.equal('とうきょう')
    })

    it('handles special case ヴ → ゔ', () => {
      expect(katakanaToHiragana('ヴ')).to.equal('ゔ')
    })

    it('keeps prolonged sound mark ー as-is', () => {
      expect(katakanaToHiragana('ー')).to.equal('ー')
    })

    it('handles mixed katakana and non-katakana', () => {
      expect(katakanaToHiragana('カタカナ123')).to.equal('かたかな123')
    })

    it('handles small katakana', () => {
      expect(katakanaToHiragana('ァィゥェォ')).to.equal('ぁぃぅぇぉ')
    })
  })

  describe('isKanji', () => {
    it('recognizes CJK Unified Ideographs', () => {
      expect(isKanji(0x4e00)).to.be.true // 一
      expect(isKanji(0x9fff)).to.be.true // Last of CJK Unified
    })

    it('recognizes CJK Extension A', () => {
      expect(isKanji(0x3400)).to.be.true
      expect(isKanji(0x4dbf)).to.be.true
    })

    it('recognizes CJK Extension B (surrogate pair range)', () => {
      expect(isKanji(0x20000)).to.be.true
      expect(isKanji(0x2a6df)).to.be.true
    })

    it('recognizes CJK Compatibility Ideographs', () => {
      expect(isKanji(0xf900)).to.be.true
      expect(isKanji(0xfaff)).to.be.true
    })

    it('rejects non-kanji code points', () => {
      expect(isKanji(0x3042)).to.be.false // あ (hiragana)
      expect(isKanji(0x30a2)).to.be.false // ア (katakana)
      expect(isKanji(0x0061)).to.be.false // a (ASCII)
    })
  })

  describe('segmentScriptRuns', () => {
    it('segments kanji and hiragana correctly', () => {
      const runs = segmentScriptRuns('食べる')
      expect(runs).to.deep.equal([
        { kind: 'kanji', charStart: 0, charEnd: 0 },
        { kind: 'other', charStart: 1, charEnd: 2 },
      ])
    })

    it('segments mixed kanji and hiragana', () => {
      const runs = segmentScriptRuns('食べる東京')
      expect(runs).to.deep.equal([
        { kind: 'kanji', charStart: 0, charEnd: 0 },
        { kind: 'other', charStart: 1, charEnd: 2 },
        { kind: 'kanji', charStart: 3, charEnd: 4 },
      ])
    })

    it('handles all non-kanji characters', () => {
      const runs = segmentScriptRuns('abc123')
      expect(runs).to.deep.equal([
        { kind: 'other', charStart: 0, charEnd: 5 },
      ])
    })

    it('handles katakana as non-kanji', () => {
      const runs = segmentScriptRuns('カタカナ')
      expect(runs).to.deep.equal([
        { kind: 'other', charStart: 0, charEnd: 3 },
      ])
    })

    it('handles consecutive kanji', () => {
      const runs = segmentScriptRuns('漢字')
      expect(runs).to.deep.equal([
        { kind: 'kanji', charStart: 0, charEnd: 1 },
      ])
    })

    it('handles empty string', () => {
      const runs = segmentScriptRuns('')
      expect(runs).to.deep.equal([])
    })
  })

  describe('hasKanji', () => {
    it('returns true for lines with kanji', () => {
      expect(hasKanji('食べる')).to.be.true
      expect(hasKanji('東京')).to.be.true
    })

    it('returns false for katakana-only lines', () => {
      expect(hasKanji('カタカナだけ')).to.be.false
    })

    it('returns false for hiragana-only lines', () => {
      expect(hasKanji('ひらがなだけ')).to.be.false
    })

    it('returns false for ASCII-only lines', () => {
      expect(hasKanji('abc123')).to.be.false
    })

    it('returns true for mixed content with kanji', () => {
      expect(hasKanji('漢字とひらがな')).to.be.true
    })

    it('handles empty string', () => {
      expect(hasKanji('')).to.be.false
    })
  })
})
