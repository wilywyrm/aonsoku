import type { RubyPart } from '@/types/furigana'
import { isKanji } from '@/utils/kana'

// One raw record of the bundled jmdict-furigana dataset. `reading` is already
// hiragana; each `furigana` part carries the substring (`ruby`) and its reading
// (`rt`); a part with no `rt` is bare (okurigana/kana).
interface RawEntry {
  text: string
  reading: string
  furigana: RubyPart[]
}

// The 33 MB dataset lives in public/dict and is served at the Vite base URL,
// which differs by context ('/' in the app, '/__cypress/src/' under Cypress),
// so resolve against import.meta.env.BASE_URL instead of a hardcoded path.
const DICT_PATH = `${import.meta.env.BASE_URL}dict/JmdictFurigana.json`

// Index key: a NUL-joined (text, reading) pair. NUL cannot appear in either
// field, so it disambiguates homographs that share a surface but differ in
// reading (e.g. 大人 = おとな vs だいにん).
const KEY = (text: string, reading: string): string => `${text}\u0000${reading}`

// Pure: fold raw entries into a lookup Map keyed by (text, reading). Kept
// separate from the fetch so tests can build an index from an inline fixture
// without touching the real file.
export function buildIndex(entries: RawEntry[]): Map<string, RubyPart[]> {
  const index = new Map<string, RubyPart[]>()
  for (const entry of entries) {
    index.set(KEY(entry.text, entry.reading), entry.furigana)
  }
  return index
}

// True iff any single part carries an `rt` spanning >=2 kanji code points. Such
// a part is a jukujikun/ateji group whose reading cannot be attributed to
// individual kanji, so the whole group must render as one unit.
export function isNonSplittable(parts: RubyPart[]): boolean {
  return parts.some((part) => {
    if (!part.rt) return false
    let kanji = 0
    for (const ch of part.ruby) {
      if (isKanji(ch.codePointAt(0)!)) kanji++
    }
    return kanji >= 2
  })
}

// Memoized load: the async promise gates concurrent callers, while the resolved
// map backs the synchronous `getIndex`/`lookup` path once parsing completes.
let indexPromise: Promise<Map<string, RubyPart[]>> | null = null
let resolvedIndex: Map<string, RubyPart[]> | null = null

// Lazily fetch, parse, and index the dataset exactly once. Safe to call
// fire-and-forget (progressive enhancement) or awaited for the built map.
export function load(): Promise<Map<string, RubyPart[]>> {
  if (!indexPromise) {
    indexPromise = fetch(DICT_PATH)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to load jmdict-furigana dataset: ${response.status}`,
          )
        }
        return response.json() as Promise<RawEntry[]>
      })
      .then((entries) => {
        const index = buildIndex(entries)
        resolvedIndex = index
        return index
      })
  }
  return indexPromise
}

// Synchronous view of the resolved index, or null before `load()` settles.
function getIndex(): Map<string, RubyPart[]> | null {
  return resolvedIndex
}

// Look up per-kanji ruby spans for a (surface, hiraganaReading) pair. Returns
// undefined before `load()` resolves or on a miss, so callers can fall back.
export function lookup(
  surface: string,
  hiraganaReading: string,
): RubyPart[] | undefined {
  const index = getIndex()
  if (!index) return undefined
  return index.get(KEY(surface, hiraganaReading))
}
