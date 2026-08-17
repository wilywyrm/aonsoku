import { useMemo } from 'react'
import { useLyricsSettings } from '@/store/player.store'
import type { IStructuredLyric } from '@/types/responses/song'
import {
  type ResolvedTransliteration,
  resolveTransliteration,
} from '@/utils/transliterationResolver'

export function useTransliterationResolver(
  pronunciationLyrics: IStructuredLyric[] | undefined,
  songId: string | undefined,
): ResolvedTransliteration {
  const {
    rubyPreference,
    linePreference,
    preferredRubyScript,
    preferredLineScript,
    perTrackTransliteration,
  } = useLyricsSettings()

  const override = songId ? perTrackTransliteration[songId] : undefined

  return useMemo(
    () =>
      resolveTransliteration(
        pronunciationLyrics,
        {
          rubyPreference,
          linePreference,
          preferredRubyScript,
          preferredLineScript,
        },
        override,
      ),
    [
      pronunciationLyrics,
      rubyPreference,
      linePreference,
      preferredRubyScript,
      preferredLineScript,
      override,
    ],
  )
}
