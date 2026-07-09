import { describe, expect, it, vi } from 'vitest'
import type { RubyLineModel } from '@/types/furigana'
import type { TokenizerLike } from './align'
import { type AnalyzerDeps, createSongAnalyzer } from './analyzeSong'

const model = (kana: string): RubyLineModel => ({
  segments: [{ charStart: 0, charEnd: 0, kana, nonSplittable: true }],
})

const emptyTokenizer: TokenizerLike = { tokenize: () => [] }

function makeDeps(over: Partial<AnalyzerDeps> = {}) {
  return {
    align: vi.fn((line: string) => model(`R:${line}`)),
    getTokenizer: vi.fn(async () => emptyTokenizer),
    loadDictionary: vi.fn(async () => {}),
    idbGet: vi.fn(async () => undefined),
    idbSet: vi.fn(async () => {}),
    schedule: (cb: () => void) => {
      cb()
    },
    ...over,
  } satisfies AnalyzerDeps
}

describe('createSongAnalyzer', () => {
  it('aligns unique lines, caches, notifies, and writes idb', async () => {
    const deps = makeDeps()
    const analyzer = createSongAnalyzer(deps)
    const seen: string[] = []
    analyzer.subscribe((line) => seen.push(line))

    await analyzer.analyze('song1', ['今日', '東京', '今日']) // 今日 duplicated

    expect(deps.align).toHaveBeenCalledTimes(2) // deduped
    expect(analyzer.get('今日')?.segments[0].kana).toBe('R:今日')
    expect(analyzer.get('東京')?.segments[0].kana).toBe('R:東京')
    expect(seen.sort()).toEqual(['今日', '東京'])
    expect(deps.idbSet).toHaveBeenCalledOnce()
    const [key, value] = deps.idbSet.mock.calls[0]
    expect(key).toContain(':furi:hira:')
    expect(Object.keys(value).sort()).toEqual(['今日', '東京'])
  })

  it('loads the jmdict dictionary before aligning', async () => {
    const order: string[] = []
    const deps = makeDeps({
      loadDictionary: vi.fn(async () => {
        order.push('dict')
      }),
      align: vi.fn((line: string) => {
        order.push('align')
        return model(`R:${line}`)
      }),
    })
    const analyzer = createSongAnalyzer(deps)
    await analyzer.analyze('s', ['東京'])
    expect(deps.loadDictionary).toHaveBeenCalledOnce()
    expect(order).toEqual(['dict', 'align'])
  })

  it('skips blank / whitespace-only lines', async () => {
    const deps = makeDeps()
    const analyzer = createSongAnalyzer(deps)
    await analyzer.analyze('s', ['  ', '', '東京'])
    expect(deps.align).toHaveBeenCalledTimes(1)
  })

  it('read-through: seeds from idb without re-aligning', async () => {
    const stored = { 東京: model('CACHED') }
    const deps = makeDeps({ idbGet: vi.fn(async () => stored) })
    const analyzer = createSongAnalyzer(deps)
    const seen: string[] = []
    analyzer.subscribe((line) => seen.push(line))

    await analyzer.analyze('s', ['東京'])

    expect(deps.align).not.toHaveBeenCalled()
    expect(analyzer.get('東京')?.segments[0].kana).toBe('CACHED')
    expect(seen).toContain('東京')
  })

  it('cancels a stale generation when the song changes', async () => {
    let releaseTokenizer!: (t: TokenizerLike) => void
    const gate = new Promise<TokenizerLike>((resolve) => {
      releaseTokenizer = resolve
    })
    const deps = makeDeps({ getTokenizer: vi.fn(() => gate) })
    const analyzer = createSongAnalyzer(deps)

    const p1 = analyzer.analyze('songA', ['A1', 'A2'])
    await Promise.resolve()
    await Promise.resolve()
    // Song B starts (bumps generation) before A gets past the tokenizer gate.
    const p2 = analyzer.analyze('songB', ['B1'])
    releaseTokenizer(emptyTokenizer)
    await p1
    await p2

    const aligned = deps.align.mock.calls.map((c) => c[0])
    expect(aligned).not.toContain('A1')
    expect(aligned).not.toContain('A2')
    expect(aligned).toContain('B1')
  })

  it('degrades gracefully when the tokenizer fails to load', async () => {
    const deps = makeDeps({
      getTokenizer: vi.fn(async () => {
        throw new Error('no dict')
      }),
    })
    const analyzer = createSongAnalyzer(deps)
    await expect(analyzer.analyze('s', ['東京'])).resolves.toBeUndefined()
    expect(analyzer.get('東京')).toBeUndefined()
    expect(deps.idbSet).not.toHaveBeenCalled()
  })

  it('clears the in-memory cache on song change', async () => {
    const deps = makeDeps()
    const analyzer = createSongAnalyzer(deps)
    await analyzer.analyze('songA', ['東京'])
    expect(analyzer.get('東京')).toBeDefined()

    await analyzer.analyze('songB', ['大阪'])
    expect(analyzer.get('東京')).toBeUndefined()
    expect(analyzer.get('大阪')).toBeDefined()
  })

  it('unsubscribe stops further notifications', async () => {
    const deps = makeDeps()
    const analyzer = createSongAnalyzer(deps)
    const seen: string[] = []
    const off = analyzer.subscribe((line) => seen.push(line))
    off()
    await analyzer.analyze('s', ['東京'])
    expect(seen).toEqual([])
  })
})
