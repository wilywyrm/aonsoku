import { describe, expect, it } from 'vitest'
import type { IStructuredLyric } from '@/types/responses/song'
import {
  findPronunciationByLang,
  pickPronunciationTracks,
  pickPrimarySyncedStructuredLyric,
} from './wordTiming'

describe('pickPrimarySyncedStructuredLyric', () => {
  it('returns main track, not pronunciation', () => {
    const list = [
      { kind: 'pronunciation', synced: true, line: [], lang: 'ja-hrkt' },
      { kind: 'main', synced: true, line: [], lang: 'ja' },
    ] as IStructuredLyric[]
    expect(pickPrimarySyncedStructuredLyric(list)?.kind).toBe('main')
  })

  it('returns undefined when only pronunciation track exists', () => {
    const list = [
      { kind: 'pronunciation', synced: true, line: [], lang: 'ja-hrkt' },
    ] as IStructuredLyric[]
    expect(pickPrimarySyncedStructuredLyric(list)).toBeUndefined()
  })

  it('treats blank kind as main', () => {
    const list = [
      { synced: true, line: [], lang: 'en' },
    ] as IStructuredLyric[]
    expect(pickPrimarySyncedStructuredLyric(list)?.lang).toBe('en')
  })

  it('skips translation tracks', () => {
    const list = [
      { kind: 'translation', synced: true, line: [], lang: 'en' },
      { kind: 'main', synced: true, line: [], lang: 'ja' },
    ] as IStructuredLyric[]
    expect(pickPrimarySyncedStructuredLyric(list)?.kind).toBe('main')
  })
})

describe('pickPronunciationTracks', () => {
  it('returns all synced pronunciation tracks', () => {
    const list = [
      { kind: 'main', synced: true, line: [], lang: 'ja' },
      { kind: 'pronunciation', synced: true, line: [], lang: 'ja-hrkt' },
      { kind: 'pronunciation', synced: true, line: [], lang: 'ja-latn' },
    ] as IStructuredLyric[]
    expect(pickPronunciationTracks(list).map((l) => l.lang)).toEqual([
      'ja-hrkt',
      'ja-latn',
    ])
  })

  it('excludes unsynced pronunciation tracks', () => {
    const list = [
      { kind: 'pronunciation', synced: false, line: [], lang: 'ja-hrkt' },
    ] as IStructuredLyric[]
    expect(pickPronunciationTracks(list)).toEqual([])
  })

  it('returns empty array for undefined list', () => {
    expect(pickPronunciationTracks(undefined)).toEqual([])
  })
})

describe('findPronunciationByLang', () => {
  it('matches case-insensitively', () => {
    const list = [
      { kind: 'pronunciation', synced: true, line: [], lang: 'ja-hrkt' },
      { kind: 'pronunciation', synced: true, line: [], lang: 'ja-latn' },
    ] as IStructuredLyric[]
    expect(findPronunciationByLang(list, 'ja-Hrkt')?.lang).toBe('ja-hrkt')
    expect(findPronunciationByLang(list, 'JA-LATN')?.lang).toBe('ja-latn')
  })

  it('returns undefined when no track matches', () => {
    const list = [
      { kind: 'pronunciation', synced: true, line: [], lang: 'ja-hrkt' },
    ] as IStructuredLyric[]
    expect(findPronunciationByLang(list, 'ja-latn')).toBeUndefined()
  })
})
