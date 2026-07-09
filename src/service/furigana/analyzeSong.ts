import type { RubyLineModel } from '@/types/furigana'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { type AlignDeps, type TokenizerLike, alignLine } from './align'
import { load as loadJmdict } from './jmdictFurigana'
import { getTokenizer } from './tokenizer'

// Bump when the dictionary or alignment algorithm changes so cached furigana is
// invalidated on the next load. 2026-07: dict-form lookup, one-unit-per-word,
// sokuon-split, re-compounding, and unread-kanji recovery all changed alignment.
export const JMDICT_VERSION = '2026-07'

export type LineModelMap = Record<string, RubyLineModel>
export type FuriganaListener = (lineValue: string, model: RubyLineModel) => void

// Every collaborator is injectable so the orchestrator can be unit-tested in
// Node without a real dictionary, IndexedDB, or the browser idle scheduler.
export interface AnalyzerDeps {
  align?: (
    line: string,
    tokenizer: TokenizerLike,
    deps?: AlignDeps,
  ) => RubyLineModel
  getTokenizer?: () => Promise<TokenizerLike>
  loadDictionary?: () => Promise<unknown>
  idbGet?: (key: string) => Promise<LineModelMap | undefined>
  idbSet?: (key: string, value: LineModelMap) => Promise<void>
  schedule?: (cb: () => void) => void
}

// Yield to the browser's idle time between line analyses so a long song never
// blocks the frame loop; fall back to a macrotask where idle callbacks are
// unavailable (Node, older engines).
function defaultSchedule(cb: () => void): void {
  const g = globalThis as {
    requestIdleCallback?: (cb: () => void) => void
  }
  if (typeof g.requestIdleCallback === 'function') {
    g.requestIdleCallback(() => cb())
  } else {
    setTimeout(cb, 0)
  }
}

export interface SongAnalyzer {
  // Pre-analyze a song's lines in the background. Fire-and-forget in
  // production; returns a promise so tests can await completion.
  analyze(cacheKey: string, lineValues: string[]): Promise<void>
  get(lineValue: string): RubyLineModel | undefined
  subscribe(listener: FuriganaListener): () => void
  dispose(): void
}

export function createSongAnalyzer(deps: AnalyzerDeps = {}): SongAnalyzer {
  const align = deps.align ?? alignLine
  const loadTokenizer = deps.getTokenizer ?? getTokenizer
  const loadDictionary = deps.loadDictionary ?? loadJmdict
  const readIdb =
    deps.idbGet ??
    (idbGet as (key: string) => Promise<LineModelMap | undefined>)
  const writeIdb =
    deps.idbSet ?? (idbSet as (key: string, value: LineModelMap) => Promise<void>)
  const schedule = deps.schedule ?? defaultSchedule

  // Keyed by line TEXT so repeated chorus lines share one analysis. Cleared on
  // song change to bound memory.
  const cache = new Map<string, RubyLineModel>()
  const listeners = new Set<FuriganaListener>()
  // Monotonic run id; a song change bumps it so stale in-flight work aborts at
  // the next checkpoint instead of writing under the previous song.
  let generation = 0
  let currentKey: string | null = null

  function notify(lineValue: string, model: RubyLineModel): void {
    for (const listener of listeners) listener(lineValue, model)
  }

  function nextIdle(): Promise<void> {
    return new Promise((resolve) => schedule(resolve))
  }

  async function run(
    gen: number,
    idbKey: string,
    unique: string[],
  ): Promise<void> {
    const stored = (await readIdb(idbKey)) ?? {}
    if (gen !== generation) return

    // Seed from the persisted cache first (progressive: subscribers can render
    // these immediately while the rest is (re)computed).
    for (const [line, model] of Object.entries(stored)) {
      if (!cache.has(line)) cache.set(line, model)
      notify(line, model)
    }

    // Start loading the jmdict-furigana dataset alongside the tokenizer; a load
    // failure degrades to kuromoji-only OOV alignment (lookups return undefined)
    // rather than aborting.
    const dictionaryReady = loadDictionary().catch(() => undefined)

    let tokenizer: TokenizerLike
    try {
      tokenizer = await loadTokenizer()
    } catch {
      // Tokenizer/dictionary unavailable: leave lyrics bare (progressive
      // enhancement) rather than surfacing an error.
      return
    }
    // Per-kanji lookups (splits, re-compounding, unread-kanji recovery) need the
    // jmdict dataset resolved before aligning.
    await dictionaryReady
    if (gen !== generation) return

    const result: LineModelMap = { ...stored }
    let dirty = false
    for (const line of unique) {
      if (cache.has(line)) continue
      // Yield between lines so tokenization never blocks the frame loop.
      await nextIdle()
      if (gen !== generation) return
      const model = align(line, tokenizer)
      cache.set(line, model)
      result[line] = model
      dirty = true
      notify(line, model)
    }

    if (gen !== generation || !dirty) return
    try {
      await writeIdb(idbKey, result)
    } catch {
      // Persistence is best-effort; a failed write must not break playback.
    }
  }

  return {
    analyze(cacheKey, lineValues) {
      if (cacheKey !== currentKey) {
        cache.clear()
        currentKey = cacheKey
      }
      const gen = ++generation
      const idbKey = `${cacheKey}:furi:hira:${JMDICT_VERSION}`
      const unique = [
        ...new Set(lineValues.filter((v) => v && v.trim().length > 0)),
      ]
      return run(gen, idbKey, unique)
    },
    get(lineValue) {
      return cache.get(lineValue)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      generation++
      listeners.clear()
      cache.clear()
      currentKey = null
    },
  }
}
