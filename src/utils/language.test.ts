import { describe, expect, it } from 'vitest'
import { isJapaneseLang } from './language'

describe('language utilities', () => {
  describe('isJapaneseLang', () => {
    it('returns true for lowercase ja', () => {
      expect(isJapaneseLang('ja')).toBe(true)
    })

    it('returns true for uppercase JA (case-insensitive)', () => {
      expect(isJapaneseLang('JA')).toBe(true)
    })

    it('returns true for jpn', () => {
      expect(isJapaneseLang('jpn')).toBe(true)
    })

    it('returns true for ja-JP (BCP-47 variant)', () => {
      expect(isJapaneseLang('ja-JP')).toBe(true)
    })

    it('returns false for jam (does not match startsWith ja-)', () => {
      expect(isJapaneseLang('jam')).toBe(false)
    })

    it('returns false for en', () => {
      expect(isJapaneseLang('en')).toBe(false)
    })

    it('returns false for und', () => {
      expect(isJapaneseLang('und')).toBe(false)
    })

    it('returns false for xxx', () => {
      expect(isJapaneseLang('xxx')).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(isJapaneseLang('')).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isJapaneseLang(undefined)).toBe(false)
    })
  })
})
