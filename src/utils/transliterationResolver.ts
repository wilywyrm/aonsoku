import type { IStructuredLyric } from '@/types/responses/song'
import { pickPronunciationTracks } from './wordTiming'

/**
 * Intent-based transliteration preferences (persisted GLOBALLY on the store).
 *
 * These describe *intent* + a tie-break *script order*, never a concrete
 * system id, so the same preference resolves sensibly across songs that ship
 * different pronunciation tracks. Concrete system ids are only ever pinned as
 * a PER-TRACK override (see {@link TransliterationOverride}).
 */
export interface TransliterationPrefs {
  /** 'off' | 'auto' — whether an overlay (per-character ruby) track is wanted. */
  rubyPreference: string
  /** 'off' | 'auto' — whether a full romanization line is wanted (opt-in). */
  linePreference: string
  /** Script-subtag tie-break order for the overlay/ruby track, e.g. ['Hrkt','Hira','Kana']. */
  preferredRubyScript: string[]
  /** Script-subtag tie-break order for the line/romaji track, e.g. ['Latn']. */
  preferredLineScript: string[]
}

/**
 * Per-track override, keyed by songId on the store. Each field is either a
 * concrete system id (the track's `lang`) or the literal 'off'. `undefined`
 * means "no override for this axis — fall back to the global preference".
 */
export interface TransliterationOverride {
  ruby?: 'off' | string
  line?: 'off' | string
}

export interface ResolvedTransliteration {
  resolvedRubySystem: string | undefined
  resolvedLineSystem: string | undefined
}

/**
 * Script subtags that mark an *overlay* (per-character ruby) pronunciation
 * track: Hiragana, Katakana, combined Hrkt, Bopomofo, Han. Matching is
 * case-insensitive against the track's BCP-47 `lang` (e.g. `ja-Hira`).
 */
const RUBY_SCRIPT_SUBTAGS = ['Hira', 'Kana', 'Hrkt', 'Bopo', 'Hani']

/** Script subtags that mark a *line* (full romanization) pronunciation track. */
const LINE_SCRIPT_SUBTAGS = ['Latn']

function langIncludes(lang: string | undefined, subtag: string): boolean {
  return (lang ?? '').toLowerCase().includes(subtag.toLowerCase())
}

/** Classify pronunciation tracks whose `lang` carries any of `subtags`. */
function classifyTracks(
  tracks: IStructuredLyric[],
  subtags: string[],
): IStructuredLyric[] {
  return tracks.filter((t) => subtags.some((s) => langIncludes(t.lang, s)))
}

/**
 * Resolve a single axis (ruby or line) against its already-classified track
 * pool. Precedence: per-track override > auto (preferred script order, then
 * first available) > off.
 */
function resolveAxis(
  tracks: IStructuredLyric[],
  override: string | undefined,
  preference: string,
  preferredScripts: string[],
): string | undefined {
  // 1. Per-track override takes precedence over everything.
  if (override === 'off') return undefined
  if (override) {
    // A concrete system was pinned: honour it only if it is actually present
    // among the suitable tracks; otherwise fall back gracefully to undefined
    // (never throw, never silently pick a different system).
    return tracks.find((t) => t.lang === override)?.lang
  }

  // 2. No override — apply the global intent.
  if (preference !== 'auto') return undefined

  // 3. Auto: walk the preferred script order, first hit wins…
  for (const script of preferredScripts) {
    const match = tracks.find((t) => langIncludes(t.lang, script))
    if (match) return match.lang
  }
  // …otherwise fall back to the first available suitable track.
  return tracks.length > 0 ? tracks[0].lang : undefined
}

/**
 * Resolve the concrete overlay (ruby) and line (romaji) systems to render for
 * the current song, from the available pronunciation tracks + the user's
 * global intent + an optional per-track override.
 *
 * Ruby and line are independent axes (never mutually exclusive). Rendering of
 * the resolved systems is owned by downstream tasks; this function only
 * decides *which* system id (if any) each axis should use.
 */
export function resolveTransliteration(
  pronunciationLyrics: IStructuredLyric[] | undefined,
  prefs: TransliterationPrefs,
  override?: TransliterationOverride,
): ResolvedTransliteration {
  const allTracks = pickPronunciationTracks(pronunciationLyrics)
  const overlayTracks = classifyTracks(allTracks, RUBY_SCRIPT_SUBTAGS)
  const lineTracks = classifyTracks(allTracks, LINE_SCRIPT_SUBTAGS)

  const resolvedRubySystem = resolveAxis(
    overlayTracks,
    override?.ruby,
    prefs.rubyPreference,
    prefs.preferredRubyScript,
  )
  const resolvedLineSystem = resolveAxis(
    lineTracks,
    override?.line,
    prefs.linePreference,
    prefs.preferredLineScript,
  )

  return { resolvedRubySystem, resolvedLineSystem }
}

/**
 * List the suitable systems for each axis (for building the in-view selector
 * options). Derived purely from available tracks + script subtags — never
 * hardcoded.
 */
export function listTransliterationOptions(
  pronunciationLyrics: IStructuredLyric[] | undefined,
): { rubySystems: string[]; lineSystems: string[] } {
  const allTracks = pickPronunciationTracks(pronunciationLyrics)
  const rubySystems = classifyTracks(allTracks, RUBY_SCRIPT_SUBTAGS)
    .map((t) => t.lang)
    .filter((l): l is string => !!l)
  const lineSystems = classifyTracks(allTracks, LINE_SCRIPT_SUBTAGS)
    .map((t) => t.lang)
    .filter((l): l is string => !!l)
  return { rubySystems, lineSystems }
}
