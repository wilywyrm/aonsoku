import { describe, expect, it } from 'vitest'
import type { IStructuredLyric } from '@/types/responses/song'
import {
  listTransliterationOptions,
  resolveTransliteration,
  type TransliterationPrefs,
} from './transliterationResolver'

/** Minimal synced pronunciation track factory for the resolver tests. */
function track(lang: string): IStructuredLyric {
  return {
    lang,
    kind: 'pronunciation',
    synced: true,
    line: [],
  } as unknown as IStructuredLyric
}

const AUTO_PREFS: TransliterationPrefs = {
  rubyPreference: 'auto',
  linePreference: 'auto',
  preferredRubyScript: ['Hrkt', 'Hira', 'Kana'],
  preferredLineScript: ['Latn'],
}

describe('resolveTransliteration', () => {
  it('auto resolves to first overlay track when available', () => {
    const tracks = [track('ja-Latn'), track('ja-Hira'), track('ja-Kana')]

    const { resolvedRubySystem } = resolveTransliteration(tracks, {
      ...AUTO_PREFS,
      linePreference: 'off',
    })

    // 'Hrkt' has no match, 'Hira' matches the first overlay track.
    expect(resolvedRubySystem).toBe('ja-Hira')
  })

  it('auto falls back to the first suitable track when no preferred script matches', () => {
    // Only a Han-script overlay track exists; none of the preferred ruby
    // scripts (Hrkt/Hira/Kana) match, so it falls back to the first overlay.
    const tracks = [track('zh-Hani')]

    const { resolvedRubySystem } = resolveTransliteration(tracks, {
      ...AUTO_PREFS,
      linePreference: 'off',
    })

    expect(resolvedRubySystem).toBe('zh-Hani')
  })

  it('returns undefined when preference is off', () => {
    const tracks = [track('ja-Hira'), track('ja-Latn')]

    const result = resolveTransliteration(tracks, {
      ...AUTO_PREFS,
      rubyPreference: 'off',
      linePreference: 'off',
    })

    expect(result.resolvedRubySystem).toBeUndefined()
    expect(result.resolvedLineSystem).toBeUndefined()
  })

  it('per-track override takes precedence over the global intent', () => {
    const tracks = [track('ja-Hira'), track('ja-Kana'), track('ja-Latn')]

    // Auto alone would pick ja-Hira (ruby) + ja-Latn (line).
    const result = resolveTransliteration(tracks, AUTO_PREFS, {
      ruby: 'ja-Kana',
      line: 'off',
    })

    expect(result.resolvedRubySystem).toBe('ja-Kana') // override beats auto
    expect(result.resolvedLineSystem).toBeUndefined() // explicit 'off' beats auto
  })

  it('override naming an absent system falls back gracefully', () => {
    const tracks = [track('ja-Hira')]

    // 'ja-Kana' is not present — must not throw, and must not silently pick a
    // different system; it resolves to undefined.
    const result = resolveTransliteration(tracks, AUTO_PREFS, {
      ruby: 'ja-Kana',
    })

    expect(result.resolvedRubySystem).toBeUndefined()
  })

  it('ruby and line resolve independently (not mutually exclusive)', () => {
    const tracks = [track('ja-Hira'), track('ja-Latn')]

    const result = resolveTransliteration(tracks, AUTO_PREFS)

    expect(result.resolvedRubySystem).toBe('ja-Hira')
    expect(result.resolvedLineSystem).toBe('ja-Latn')
  })

  it('handles no pronunciation tracks without throwing', () => {
    const result = resolveTransliteration(undefined, AUTO_PREFS)
    expect(result.resolvedRubySystem).toBeUndefined()
    expect(result.resolvedLineSystem).toBeUndefined()
  })
})

describe('listTransliterationOptions', () => {
  it('splits available tracks into ruby vs line systems by script subtag', () => {
    const tracks = [
      track('ja-Hira'),
      track('ja-Kana'),
      track('ja-Latn'),
      track('main'), // not a pronunciation-classified script — excluded
    ]

    const { rubySystems, lineSystems } = listTransliterationOptions(tracks)

    expect(rubySystems).toEqual(['ja-Hira', 'ja-Kana'])
    expect(lineSystems).toEqual(['ja-Latn'])
  })
})
