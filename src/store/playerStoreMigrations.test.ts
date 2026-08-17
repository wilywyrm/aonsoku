import { describe, expect, it } from 'vitest'
import {
  migrateLyricsTransliteration,
  migratePlayerState,
} from './playerStoreMigrations'

describe('migrateLyricsTransliteration', () => {
  it('migrates furigana:true to rubyPreference:auto', () => {
    const result = migrateLyricsTransliteration({ furigana: true })
    expect(result.rubyPreference).toBe('auto')
    expect(result.furigana).toBeUndefined()
  })

  it('migrates furigana:false to rubyPreference:off', () => {
    const result = migrateLyricsTransliteration({ furigana: false })
    expect(result.rubyPreference).toBe('off')
    expect(result.furigana).toBeUndefined()
  })

  it('defaults rubyPreference to auto when furigana is absent', () => {
    const result = migrateLyricsTransliteration({})
    expect(result.rubyPreference).toBe('auto')
  })

  it('fills the remaining transliteration defaults', () => {
    const result = migrateLyricsTransliteration({ furigana: true })
    expect(result.linePreference).toBe('off')
    expect(result.preferredRubyScript).toEqual(['Hrkt', 'Hira', 'Kana'])
    expect(result.preferredLineScript).toEqual(['Latn'])
    expect(result.perTrackTransliteration).toEqual({})
  })

  it('does not override an already-migrated preference', () => {
    const result = migrateLyricsTransliteration({
      furigana: true,
      rubyPreference: 'off',
    })
    expect(result.rubyPreference).toBe('off')
  })
})

describe('migratePlayerState', () => {
  it('migrates the nested lyrics settings from a persisted player state', () => {
    const persisted = {
      settings: {
        lyrics: { preferSyncedLyrics: true, furigana: true },
      },
    }

    const migrated = migratePlayerState(persisted, 1) as typeof persisted & {
      settings: { lyrics: { rubyPreference?: string; furigana?: boolean } }
    }

    expect(migrated.settings.lyrics.rubyPreference).toBe('auto')
    expect(migrated.settings.lyrics.furigana).toBeUndefined()
    expect(migrated.settings.lyrics.preferSyncedLyrics).toBe(true)
  })

  it('passes through non-object states untouched', () => {
    expect(migratePlayerState(undefined, 1)).toBeUndefined()
    expect(migratePlayerState(null, 1)).toBeNull()
  })
})
