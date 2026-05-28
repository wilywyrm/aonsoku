import { useCallback, useEffect, useMemo, useRef } from 'react'
import { isSafari } from 'react-device-detect'
import { useRafActiveCue } from '@/hooks/use-raf-active-cue'
import { useWordSeek } from '@/hooks/use-word-seek'
import { useLang } from '@/store/lang.store'
import { usePlayerRef } from '@/store/player.store'
import type { IStructuredLyric } from '@/types/responses/song'
import { normalizeStructuredLyric } from '@/utils/wordTiming'
import { resolveLyricsLang } from '../lyrics'
import { WordLevelLyricsView } from './view'

const SCROLL_RECOVERY_MS = 1500

export interface WordLevelLyricsContainerProps {
  structuredLyric: IStructuredLyric
  /** When false, disables rAF polling (e.g. component not visible). Defaults to true. */
  enabled?: boolean
}

export function WordLevelLyricsContainer({
  structuredLyric,
  enabled = true,
}: WordLevelLyricsContainerProps) {
  // Normalise once; re-normalise only when the raw data reference changes.
  const normalized = useMemo(
    () => normalizeStructuredLyric(structuredLyric),
    [structuredLyric],
  )

  // Language resolution — mirrors existing lyrics.tsx pattern.
  const { langCode } = useLang()
  const resolvedLang = useMemo(
    () => resolveLyricsLang(normalized.lang, langCode),
    [normalized.lang, langCode],
  )

  // Audio time getter — passed to the rAF hook so the hook stays store-agnostic.
  const playerRef = usePlayerRef()
  const getCurrentTimeMs = useCallback(
    () => (playerRef?.currentTime ?? 0) * 1000,
    [playerRef],
  )

  // 60fps active-index tracking.
  const { activeLineIdx, activeCueByKey } = useRafActiveCue({
    lines: normalized.lines,
    getCurrentTimeMs,
    enabled: enabled && normalized.hasWordTiming,
  })

  // Click-to-seek callback (cue.start already has offset baked in).
  const onWordClick = useWordSeek()

  // Refs for DOM nodes.
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])

  // Auto-scroll with recovery — mirrors react-lrc's recoverAutoScrollInterval={1500}.
  const userScrollGuardRef = useRef({ pausedUntilMs: 0 })
  const programmaticScrollRef = useRef(false)

  // Attach scroll listener to detect user-initiated scrolls.
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const onScroll = () => {
      // Ignore scroll events caused by our own programmatic scrollIntoView.
      if (programmaticScrollRef.current) return
      userScrollGuardRef.current.pausedUntilMs =
        performance.now() + SCROLL_RECOVERY_MS
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Scroll active line into view when it changes. Fires once per activeLineIdx
  // change — never per rAF tick — because the effect depends on activeLineIdx.
  useEffect(() => {
    if (activeLineIdx < 0) return
    if (performance.now() < userScrollGuardRef.current.pausedUntilMs) return

    const lineEl = lineRefs.current[activeLineIdx]
    if (!lineEl) return

    programmaticScrollRef.current = true
    lineEl.scrollIntoView({
      behavior: isSafari ? 'auto' : 'smooth',
      block: 'center',
    })
    // Clear the flag after the browser has processed the scroll event.
    const handle = setTimeout(() => {
      programmaticScrollRef.current = false
    }, 0)
    return () => clearTimeout(handle)
  }, [activeLineIdx])

  // Defensive: should never be mounted without word timing, but bail out safely.
  if (!normalized.hasWordTiming) return null

  return (
    <WordLevelLyricsView
      data={normalized}
      activeLineIdx={activeLineIdx}
      activeCueByKey={activeCueByKey}
      onWordClick={onWordClick}
      resolvedLang={resolvedLang}
      scrollContainerRef={scrollContainerRef}
      lineRefs={lineRefs}
    />
  )
}
