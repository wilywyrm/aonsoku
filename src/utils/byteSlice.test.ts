import { describe, expect, it } from 'vitest'
import { buildMainCueGaps, byteSliceFallback } from './byteSlice'

type TestCue = { value?: string; byteStart?: number; byteEnd?: number }

function cue(value: string, byteStart?: number, byteEnd?: number): TestCue {
  return { value, byteStart, byteEnd }
}

/**
 * Rebuild the visible line exactly as the word-level view does: each cue's byte
 * slice interleaved with the uncovered gap text {@link buildMainCueGaps} yields.
 */
function reconstruct(cues: TestCue[], value: string): string {
  const { leads, tail } = buildMainCueGaps(cues, value)
  return (
    cues.reduce(
      (acc, c, i) => acc + leads[i] + byteSliceFallback(c, value),
      '',
    ) + tail
  )
}

describe('buildMainCueGaps', () => {
  it('keeps a space that sits between two cue byte ranges (hello world)', () => {
    const value = 'hello world'
    const cues = [cue('hello', 0, 4), cue('world', 6, 10)]

    const { leads, tail } = buildMainCueGaps(cues, value)

    expect(leads).toEqual(['', ' '])
    expect(tail).toBe('')
    expect(reconstruct(cues, value)).toBe('hello world')
  })

  it('emits no gaps when cues are contiguous (CJK line 今日は天気)', () => {
    const value = '今日は天気'
    const cues = [cue('今日', 0, 5), cue('は', 6, 8), cue('天気', 9, 14)]

    const { leads, tail } = buildMainCueGaps(cues, value)

    expect(leads).toEqual(['', '', ''])
    expect(tail).toBe('')
    expect(reconstruct(cues, value)).toBe(value)
  })

  it('recovers a space between multi-byte characters (가 나)', () => {
    // 가 = bytes 0-2, space = 3, 나 = 4-6; the cues skip the space byte.
    const value = '가 나'
    const cues = [cue('가', 0, 2), cue('나', 4, 6)]

    expect(buildMainCueGaps(cues, value).leads).toEqual(['', ' '])
    expect(reconstruct(cues, value)).toBe('가 나')
  })

  it('recovers a leading gap before the first cue', () => {
    const value = ' hi'
    const cues = [cue('hi', 1, 2)]

    expect(buildMainCueGaps(cues, value).leads).toEqual([' '])
    expect(reconstruct(cues, value)).toBe(' hi')
  })

  it('recovers a trailing gap after the last cue', () => {
    const value = 'hi '
    const cues = [cue('hi', 0, 1)]

    expect(buildMainCueGaps(cues, value).tail).toBe(' ')
    expect(reconstruct(cues, value)).toBe('hi ')
  })

  it('recovers multiple word gaps in one line (a b c)', () => {
    const value = 'a b c'
    const cues = [cue('a', 0, 0), cue('b', 2, 2), cue('c', 4, 4)]

    expect(buildMainCueGaps(cues, value).leads).toEqual(['', ' ', ' '])
    expect(reconstruct(cues, value)).toBe('a b c')
  })

  it('does not double a space already carried by a whitespace-only cue', () => {
    const value = 'A B'
    const cues = [cue('A', 0, 0), cue(' ', 1, 1), cue('B', 2, 2)]

    const { leads, tail } = buildMainCueGaps(cues, value)

    expect(leads).toEqual(['', '', ''])
    expect(tail).toBe('')
    expect(reconstruct(cues, value)).toBe('A B')
  })

  it('returns all-empty when no cue carries byte offsets (cue.value fallback)', () => {
    const cues = [cue('foo'), cue('bar')]

    const { leads, tail } = buildMainCueGaps(cues, 'foo bar')

    expect(leads).toEqual(['', ''])
    expect(tail).toBe('')
    expect(reconstruct(cues, 'foo bar')).toBe('foobar')
  })

  it('returns all-empty when only some cues carry byte offsets', () => {
    const cues = [cue('a', 0, 0), cue('b')]

    const { leads, tail } = buildMainCueGaps(cues, 'a b')

    expect(leads).toEqual(['', ''])
    expect(tail).toBe('')
  })

  it('returns all-empty for an empty value or empty cue list', () => {
    expect(buildMainCueGaps([cue('x', 0, 0)], '')).toEqual({
      leads: [''],
      tail: '',
    })
    expect(buildMainCueGaps([], 'abc')).toEqual({ leads: [], tail: '' })
  })
})
