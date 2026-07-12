import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import {
  ComponentPropsWithoutRef,
  useEffect,
  useMemo,
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
import {
  createSongAnalyzer,
  type LineModelMap,
} from '@/service/furigana/analyzeSong'
import { normalizeLrcContent } from '@/service/furigana/lineRuby'
import { subsonic } from '@/service/subsonic'
import { useAppStore } from '@/store/app.store'
import { useLang } from '@/store/lang.store'
import {
  useLyricsSettings,
  usePlayerRef,
  usePlayerSonglist,
} from '@/store/player.store'
import type { RubyLineModel } from '@/types/furigana'
import { ILyric, type IStructuredLyric } from '@/types/responses/song'
import { isJapaneseLang } from '@/utils/language'
import { getServerExtensions } from '@/utils/servers'
import { LineRubyContent } from './line-ruby-content'
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
  structuredLyric?: IStructuredLyric
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
    if (hasWordData && lyrics.structuredLyric) {
      return (
        <div
          data-testid="lyrics-mode"
          data-mode="word"
          className="w-full h-full"
        >
          <WordLevelLyricsContainer structuredLyric={lyrics.structuredLyric} />
        </div>
      )
    }
    return areLyricsSynced(lyrics) ? (
      <div data-testid="lyrics-mode" data-mode="line" className="w-full h-full">
        <SyncedLyrics
          lyrics={lyrics}
          structuredLyric={lyrics.structuredLyric}
        />
      </div>
    ) : (
      <div
        data-testid="lyrics-mode"
        data-mode="plain"
        className="w-full h-full"
      >
        <UnsyncedLyrics lyrics={lyrics} />
      </div>
    )
  } else {
    return <CenteredMessage>{noLyricsFound}</CenteredMessage>
  }
}

function SyncedLyrics({ lyrics, structuredLyric }: SyncedLyricsProps) {
  const playerRef = usePlayerRef()
  const { langCode } = useLang()
  const [progress, setProgress] = useState(0)
  const { furigana } = useLyricsSettings()

  const furiganaActive =
    !!structuredLyric &&
    structuredLyric.synced &&
    isJapaneseLang(structuredLyric.lang) &&
    furigana

  const resolvedLang = resolveLyricsLang(structuredLyric?.lang, langCode)

  const analyzer = useMemo(
    () =>
      createSongAnalyzer({
        idbGet: (key) =>
          useAppStore.getState().pages.lyricsCacheEnabled
            ? idbGet<LineModelMap>(key)
            : Promise.resolve(undefined),
        idbSet: (key, value) =>
          useAppStore.getState().pages.lyricsCacheEnabled
            ? idbSet(key, value)
            : Promise.resolve(),
      }),
    [],
  )

  const [rubyModels, setRubyModels] = useState<
    ReadonlyMap<string, RubyLineModel>
  >(() => new Map())

  const expectedRubyLines = useMemo(() => {
    if (!structuredLyric) return 0
    return new Set(
      structuredLyric.line
        .map((l) => l.value)
        .filter((v) => v && v.trim().length > 0),
    ).size
  }, [structuredLyric])

  const rubyLayoutSettled =
    furiganaActive &&
    expectedRubyLines > 0 &&
    rubyModels.size >= expectedRubyLines

  useEffect(() => {
    if (
      !structuredLyric ||
      !structuredLyric.synced ||
      !isJapaneseLang(structuredLyric.lang) ||
      !furigana
    ) {
      setRubyModels(new Map())
      return
    }
    const lineValues = structuredLyric.line.map((l) => l.value)
    const seeded = new Map<string, RubyLineModel>()
    for (const value of lineValues) {
      const model = analyzer.get(value)
      if (model) seeded.set(value, model)
    }
    setRubyModels(seeded)
    const cacheKey = `${structuredLyric.displayArtist ?? ''}:${structuredLyric.displayTitle ?? ''}`
    const unsubscribe = analyzer.subscribe((lineValue, model) => {
      setRubyModels((prev) => {
        if (prev.get(lineValue) === model) return prev
        const next = new Map(prev)
        next.set(lineValue, model)
        return next
      })
    })
    analyzer.analyze(cacheKey, lineValues).catch(() => undefined)
    return unsubscribe
  }, [analyzer, structuredLyric, furigana])

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
        // ResizeObserver only watches the root box, so async furigana height
        // changes go unmeasured; remount on layout change to re-measure.
        key={`${furiganaActive}:${rubyLayoutSettled}`}
        lrc={lyrics.value!}
        recoverAutoScrollInterval={1500}
        currentMillisecond={progress}
        id="sync-lyrics-box"
        className={clsx('h-full overflow-y-auto', !isSafari && 'scroll-smooth')}
        verticalSpace={true}
        lineRenderer={({ active, line }) => {
          const value = normalizeLrcContent(line.content)
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
              {furiganaActive ? (
                <LineRubyContent text={value} model={rubyModels.get(value)} />
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

function areLyricsSynced(lyrics: ILyric) {
  // Most LRC files start with the string "[00:" or "[01:" indicating synced lyrics
  const lyric = lyrics.value?.trim() ?? ''
  return (
    lyric.startsWith('[00:') ||
    lyric.startsWith('[01:') ||
    lyric.startsWith('[02:')
  )
}
