interface PersistedLyricsLike {
  furigana?: boolean
  rubyPreference?: string
  linePreference?: string
  preferredRubyScript?: string[]
  preferredLineScript?: string[]
  perTrackTransliteration?: Record<string, { ruby?: string; line?: string }>
  [key: string]: unknown
}

const DEFAULT_PREFERRED_RUBY_SCRIPT = ['Hrkt', 'Hira', 'Kana']
const DEFAULT_PREFERRED_LINE_SCRIPT = ['Latn']

export function migrateLyricsTransliteration(
  lyrics: PersistedLyricsLike | undefined,
): PersistedLyricsLike {
  const next: PersistedLyricsLike = { ...(lyrics ?? {}) }

  if (next.rubyPreference == null) {
    next.rubyPreference = next.furigana === false ? 'off' : 'auto'
  }
  if (next.linePreference == null) next.linePreference = 'off'
  if (!Array.isArray(next.preferredRubyScript)) {
    next.preferredRubyScript = [...DEFAULT_PREFERRED_RUBY_SCRIPT]
  }
  if (!Array.isArray(next.preferredLineScript)) {
    next.preferredLineScript = [...DEFAULT_PREFERRED_LINE_SCRIPT]
  }
  if (
    next.perTrackTransliteration == null ||
    typeof next.perTrackTransliteration !== 'object'
  ) {
    next.perTrackTransliteration = {}
  }

  delete next.furigana
  return next
}

export function migratePlayerState(
  persistedState: unknown,
  _version: number,
): unknown {
  if (!persistedState || typeof persistedState !== 'object') {
    return persistedState
  }
  const state = persistedState as {
    settings?: { lyrics?: PersistedLyricsLike }
  }
  if (state.settings && typeof state.settings === 'object') {
    state.settings.lyrics = migrateLyricsTransliteration(state.settings.lyrics)
  }
  return state
}
