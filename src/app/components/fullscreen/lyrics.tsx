import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  ComponentPropsWithoutRef,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { isSafari } from 'react-device-detect'
import { useTranslation } from 'react-i18next'
import { Lrc } from 'react-lrc'
import {
  ScrollArea,
  scrollAreaViewportSelector,
} from '@/app/components/ui/scroll-area'
import { normalizeLrcContent } from '@/service/furigana/lineRuby'
import { subsonic } from '@/service/subsonic'
import { useLang } from '@/store/lang.store'
import {
  useLyricsSettings,
  usePlayerRef,
  usePlayerSonglist,
} from '@/store/player.store'
import type { RubyLineModel } from '@/types/furigana'
import type { IStructuredLyric } from '@/types/responses/song'
import { ILyric } from '@/types/responses/song'
import { getServerExtensions } from '@/utils/servers'
import { LineRubyContent } from './line-ruby-content'
import { LyricsOptions } from './lyrics-options'
import { WordLevelLyricsContainer } from './word-level-lyrics'

// disambiguates chinese language code to the user's locale if set
export function resolveLyricsLang(
  lyricsLang: string | undefined,
  appLocale: string,
): string | undefined {
  if (!lyricsLang || lyricsLang !== 'zh') return lyricsLang
  if (appLocale === 'yue-Hant') return 'zh-Hant'
  return 'zh-Hans'
}

interface LyricProps {
  lyrics: ILyric
}

interface SyncedLyricsProps {
  lyrics: ILyric
  /**
   * Explicit, pre-computed ruby line models keyed by react-lrc's parsed line
   * `index`. Supplied by the caller — this component does NO inference. When
   * absent or a line has no entry, that line renders as plain text. The caller
   * owns the decision of whether to build models (language / settings) and must
   * key the map to match react-lrc's line order.
   */
  rubyModels?: Map<number, RubyLineModel>
}

export function LyricsTab() {
  const { currentSong } = usePlayerSonglist()
  const { t } = useTranslation()
  const { songLyricsV2Enabled } = getServerExtensions()
  const { preferWordLevelLyrics } = useLyricsSettings()

  const { id, artist, title, duration } = currentSong

  const { data: lyrics, isLoading } = useQuery({
    queryKey: ['get-lyrics', id, artist, title, duration],
    queryFn: () =>
      subsonic.lyrics.getLyrics({
        id,
        artist,
        title,
        duration,
      }),
    enabled: !!id,
  })

  const noLyricsFound = t('fullscreen.noLyrics')
  const loadingLyrics = t('fullscreen.loadingLyrics')

  if (isLoading) {
    return <CenteredMessage>{loadingLyrics}</CenteredMessage>
  } else if (lyrics && lyrics.value) {
    const hasWordData =
      songLyricsV2Enabled &&
      preferWordLevelLyrics &&
      !!lyrics.structuredLyric?.cueLine?.some((cl) =>
        cl.cue.some((c) => c.start != null),
      )
    const shellProps = {
      lang: lyrics.lang,
      songId: id,
      pronunciationLyrics: lyrics.pronunciationLyrics,
    }
    if (hasWordData && lyrics.structuredLyric) {
      return (
        <LyricsTabShell {...shellProps}>
          <div
            data-testid="lyrics-mode"
            data-mode="word"
            className="w-full h-full"
          >
            <WordLevelLyricsContainer
              structuredLyric={lyrics.structuredLyric}
            />
          </div>
        </LyricsTabShell>
      )
    }
    return areLyricsSynced(lyrics) ? (
      <LyricsTabShell {...shellProps}>
        <div
          data-testid="lyrics-mode"
          data-mode="line"
          className="w-full h-full"
        >
          <SyncedLyrics lyrics={lyrics} />
        </div>
      </LyricsTabShell>
    ) : (
      <LyricsTabShell {...shellProps}>
        <div
          data-testid="lyrics-mode"
          data-mode="plain"
          className="w-full h-full"
        >
          <UnsyncedLyrics lyrics={lyrics} />
        </div>
      </LyricsTabShell>
    )
  } else {
    return <CenteredMessage>{noLyricsFound}</CenteredMessage>
  }
}

function SyncedLyrics({ lyrics, rubyModels }: SyncedLyricsProps) {
  const playerRef = usePlayerRef()
  const { langCode } = useLang()
  const [progress, setProgress] = useState(0)
  const resolvedLang = resolveLyricsLang(lyrics.lang, langCode)

  setTimeout(() => {
    let newProgress = (playerRef?.currentTime || 0) * 1000

    if (newProgress === progress) {
      newProgress += 1 // Prevents the lyrics from getting stuck when the audio is still loading
    }

    setProgress(newProgress)
  }, 50)

  const skipToTime = (timeMs: number) => {
    if (playerRef) {
      playerRef!.currentTime = timeMs / 1000
    }
  }

  return (
    <div className="w-full h-full text-center font-semibold text-2xl 2xl:text-3xl px-2 lrc-box maskImage-big-player-lyrics">
      <Lrc
        // react-lrc measures each line's offsetTop once at mount and its
        // ResizeObserver only watches the root box, so ruby height changes go
        // unmeasured; remount when the ruby model count changes to re-measure.
        key={`ruby:${rubyModels?.size ?? 0}`}
        lrc={lyrics.value!}
        recoverAutoScrollInterval={1500}
        currentMillisecond={progress}
        id="sync-lyrics-box"
        className={clsx('h-full overflow-y-auto', !isSafari && 'scroll-smooth')}
        verticalSpace={true}
        lineRenderer={({ active, line, index }) => {
          const model = rubyModels?.get(index)
          return (
            <p
              onClick={() => skipToTime(line.startMillisecond)}
              className={clsx(
                'text-shadow-lg my-5 cursor-pointer hover:opacity-100 duration-500',
                'transition-[opacity,transform] motion-reduce:transition-none',
                active ? 'opacity-100 scale-125' : 'opacity-50',
              )}
              lang={resolvedLang}
            >
              {model ? (
                <LineRubyContent
                  text={normalizeLrcContent(line.content)}
                  model={model}
                />
              ) : (
                line.content
              )}
            </p>
          )
        }}
      />
    </div>
  )
}

function UnsyncedLyrics({ lyrics }: LyricProps) {
  const { currentSong } = usePlayerSonglist()
  const { langCode } = useLang()
  const lyricsBoxRef = useRef<HTMLDivElement>(null)
  const resolvedLang = resolveLyricsLang(lyrics.lang, langCode)

  const lines = lyrics.value!.split('\n')

  // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed when song changes
  useEffect(() => {
    if (lyricsBoxRef.current) {
      const scrollArea = lyricsBoxRef.current.querySelector(
        scrollAreaViewportSelector,
      ) as HTMLDivElement

      scrollArea.scrollTo({
        top: 0,
        behavior: 'smooth',
      })
    }
  }, [currentSong])

  return (
    <ScrollArea
      type="always"
      className="w-full h-full overflow-y-auto text-center font-semibold text-xl 2xl:text-2xl px-2 scroll-smooth maskImage-unsynced-lyrics"
      thumbClassName="secondary-thumb-bar"
      ref={lyricsBoxRef}
    >
      {lines.map((line, index) => (
        <p
          key={index}
          className={clsx(
            'leading-10 text-shadow-lg text-balance',
            index === 0 && 'mt-4',
            index === lines.length - 1 && 'mb-16',
          )}
          lang={resolvedLang}
        >
          {line}
        </p>
      ))}
    </ScrollArea>
  )
}

type CenteredMessageProps = ComponentPropsWithoutRef<'p'>

function CenteredMessage({ children }: CenteredMessageProps) {
  return (
    <div className="w-full h-full flex justify-center items-center">
      <p className="leading-10 text-shadow-lg text-center font-semibold text-xl 2xl:text-2xl">
        {children}
      </p>
    </div>
  )
}

interface LyricsTabShellProps {
  lang?: string
  songId?: string
  pronunciationLyrics?: IStructuredLyric[]
  children: ReactNode
}

function LyricsTabShell({
  lang,
  songId,
  pronunciationLyrics,
  children,
}: LyricsTabShellProps) {
  return (
    <div className="relative w-full h-full">
      <div className="absolute right-2 top-2 z-10">
        <LyricsOptions
          lang={lang}
          songId={songId}
          pronunciationLyrics={pronunciationLyrics}
        />
      </div>
      {children}
    </div>
  )
}

function areLyricsSynced(lyrics: ILyric) {
  // Most LRC files start with the string "[00:" or "[01:" indicating synced lyrics
  const lyric = lyrics.value?.trim() ?? ''
  return (
    lyric.startsWith('[00:') ||
    lyric.startsWith('[01:') ||
    lyric.startsWith('[02:')
  )
}
