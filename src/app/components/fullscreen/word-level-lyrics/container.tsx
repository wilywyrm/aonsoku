import { get as idbGet, set as idbSet } from 'idb-keyval'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isSafari } from 'react-device-detect'
import { type RafTickInfo, useRafActiveCue } from '@/hooks/use-raf-active-cue'
import { useWordSeek } from '@/hooks/use-word-seek'
import { useAppStore } from '@/store/app.store'
import { useLang } from '@/store/lang.store'
import { useLyricsSettings, usePlayerRef } from '@/store/player.store'
import {
  createSongAnalyzer,
  type LineModelMap,
} from '@/service/furigana/analyzeSong'
import { mergeCollidingUnits } from '@/service/furigana/grouping'
import { reconcile } from '@/service/furigana/reconcile'
import {
  computeWipeLayout,
  unitWipePct,
  type WipeLayout,
  wipeFrontChar,
} from '@/service/furigana/wipeFront'
import {
  type RenderUnit,
  type RubyLineModel,
  rubyUnitKey,
} from '@/types/furigana'
import type { IStructuredLyric } from '@/types/responses/song'
import { normalizeStructuredLyric } from '@/utils/wordTiming'
import { resolveLyricsLang } from '../lyrics'
import { WordLevelLyricsView } from './view'

const SCROLL_RECOVERY_MS = 1500

function isJapaneseLang(lang?: string): boolean {
  if (!lang) return false
  const l = lang.toLowerCase()
  return l === 'ja' || l === 'jpn' || l.startsWith('ja-')
}

function useScrollToElementWithRecovery(
  trigger: unknown,
  scrollContainerRef: React.RefObject<HTMLDivElement>,
  programmaticScrollRef: React.MutableRefObject<boolean>,
  userScrollGuardRef: React.MutableRefObject<{ pausedUntilMs: number }>,
  resolveTarget: () => HTMLElement | null,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger is the explicit driver; resolveTarget reads stable refs
  useEffect(() => {
    if (trigger == null) return
    if (performance.now() < userScrollGuardRef.current.pausedUntilMs) return

    const targetEl = resolveTarget()
    const scrollEl = scrollContainerRef.current
    if (!targetEl || !scrollEl) return

    programmaticScrollRef.current = true
    targetEl.scrollIntoView({
      behavior: isSafari ? 'auto' : 'smooth',
      block: 'center',
    })

    const clearFlag = () => {
      programmaticScrollRef.current = false
    }

    // Smooth scrollIntoView dispatches async `scroll` events for ~300-500ms;
    // hold the programmatic flag until the real end, otherwise the scroll
    // listener treats them as a user scroll and pauses auto-scroll. Prefer
    // `scrollend` over a timer.
    if ('onscrollend' in scrollEl) {
      scrollEl.addEventListener('scrollend', clearFlag, { once: true })
      return () => {
        scrollEl.removeEventListener('scrollend', clearFlag)
      }
    }
    const handle = setTimeout(clearFlag, 700)
    return () => clearTimeout(handle)
  }, [trigger])
}

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

  const { langCode } = useLang()
  const { furigana } = useLyricsSettings()
  const resolvedLang = useMemo(
    () => resolveLyricsLang(normalized.lang, langCode),
    [normalized.lang, langCode],
  )

  const analyzer = useMemo(
    () =>
      createSongAnalyzer({
        // Persist ruby models only while the lyrics cache is enabled (mirrors
        // src/service/lyrics.ts) so toggling the cache off serves fresh results.
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

  useEffect(() => {
    if (!isJapaneseLang(normalized.lang) || !furigana) {
      setRubyModels(new Map())
      return
    }
    const lineValues: string[] = []
    for (const line of normalized.lines) {
      for (const cueLine of line.cueLines) lineValues.push(cueLine.value)
    }
    // Seed models the analyzer already cached: it caches per song and only
    // re-notifies UNcached lines, so re-enabling furigana mid-song would leave
    // the already-analysed lines blank without this.
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
  }, [
    analyzer,
    normalized,
    structuredLyric.displayArtist,
    structuredLyric.displayTitle,
    furigana,
  ])

  const { rubyUnitsByLineCue, wipeLayoutsByLineCue } = useMemo(() => {
    const units = new Map<string, RenderUnit[]>()
    const layouts = new Map<string, WipeLayout>()
    if (rubyModels.size === 0) {
      return { rubyUnitsByLineCue: units, wipeLayoutsByLineCue: layouts }
    }
    normalized.lines.forEach((line, i) => {
      for (const cueLine of line.cueLines) {
        const model = rubyModels.get(cueLine.value)
        if (!model) continue
        const key = `${i}|${cueLine.key}`
        // Merge adjacent kanji units whose readings would overhang into each
        // other (e.g. 心構えても → 心 + 構え split across cues) so the shared
        // wipe layout and the render agree on one group-ruby unit.
        const u = mergeCollidingUnits(reconcile(model, cueLine.cues, cueLine.value))
        units.set(key, u)
        // Precompute the shared-front char layout once per cueLine, not per frame.
        layouts.set(key, computeWipeLayout(u, cueLine.cues.length))
      }
    })
    return { rubyUnitsByLineCue: units, wipeLayoutsByLineCue: layouts }
  }, [normalized, rubyModels])

  // Mirror into refs so the rAF tick reads current units + layout without
  // re-subscribing.
  const rubyUnitsRef = useRef(rubyUnitsByLineCue)
  rubyUnitsRef.current = rubyUnitsByLineCue
  const wipeLayoutsRef = useRef(wipeLayoutsByLineCue)
  wipeLayoutsRef.current = wipeLayoutsByLineCue

  // Audio time getter — passed to the rAF hook so the hook stays store-agnostic.
  const playerRef = usePlayerRef()
  const getCurrentTimeMs = useCallback(
    () => (playerRef?.currentTime ?? 0) * 1000,
    [playerRef],
  )

  // Per-cue <span> registry. Each rendered cue span registers/unregisters
  // itself via `registerWordRef`. We use a Map so writes are O(1); the keys
  // mirror view.tsx's `${i}|${cueLine.key}|${cueIdx}` format.
  const wordRefs = useRef<Map<string, HTMLSpanElement>>(new Map())
  const registerWordRef = useCallback(
    (key: string, el: HTMLSpanElement | null) => {
      if (el) wordRefs.current.set(key, el)
      else wordRefs.current.delete(key)
    },
    [],
  )

  // Per-dot <span> registry for instrumental break indicators. Same DOM-direct
  // --fill pattern as wordRefs; keys match view.tsx's `${break.key}|${dotIdx}`.
  const dotRefs = useRef<Map<string, HTMLSpanElement>>(new Map())
  const registerDotRef = useCallback(
    (key: string, el: HTMLSpanElement | null) => {
      if (el) dotRefs.current.set(key, el)
      else dotRefs.current.delete(key)
    },
    [],
  )

  // Tracks which break dot is currently active (if any). State changes only on
  // dot transitions (~1Hz during a break), keeping React re-renders minimal.
  // The ref shadow lets handleTick read the previous value without a closure
  // over state, mirroring the lineIdxRef/cueByKeyRef pattern in useRafActiveCue.
  const [activeBreakInfo, setActiveBreakInfo] = useState<{
    breakKey: string
    dotIdx: number
  } | null>(null)
  const activeBreakInfoRef = useRef<{
    breakKey: string
    dotIdx: number
  } | null>(null)

  // Karaoke wipe progress channel. Fires every animation frame from
  // useRafActiveCue. Writes `--fill` directly to each active cue's <span> DOM
  // node — NOT via React state — so smooth 60fps fill costs zero re-renders.
  // Iterates the entire cluster (activeLineIndices) so concurrent voices on
  // different line indices each get their own karaoke wipe simultaneously.
  // Only the active cue(s) get a write; past/future cues lack the
  // `.karaoke-fill` class so their `--fill` value is inert.
  const handleTick = useCallback(
    ({
      t,
      activeLineIndices: lineIndices,
      activeCueByKey: cueByKey,
    }: RafTickInfo) => {
      for (const lineIdx of lineIndices) {
        const line = normalized.lines[lineIdx]
        if (!line) continue
        for (const cueLine of line.cueLines) {
          const cueIdx = cueByKey[cueLine.key]
          if (cueIdx == null || cueIdx < 0) continue

          // Furigana cueLines wipe as ONE shared front per cue: every unit in
          // the active cue (kanji group, bare okurigana, paren, particle) fills
          // only as the front crosses its own char slice, so a cue never shows
          // parallel wipes. Non-furigana cueLines keep the legacy per-cue --fill.
          const units = rubyUnitsRef.current.get(`${lineIdx}|${cueLine.key}`)
          const layout = wipeLayoutsRef.current.get(`${lineIdx}|${cueLine.key}`)
          if (units && layout) {
            const activeCue = cueLine.cues[cueIdx]
            const front = wipeFrontChar(
              t,
              cueIdx,
              activeCue?.start ?? 0,
              activeCue?.end ?? 0,
              layout,
            )
            for (let unitIdx = 0; unitIdx < units.length; unitIdx++) {
              const unit = units[unitIdx]
              if (!unit.coveringCueIdx.includes(cueIdx)) continue
              const unitPct = unitWipePct(front, unitIdx, layout)
              const unitEl = wordRefs.current.get(
                rubyUnitKey(
                  lineIdx,
                  cueLine.key,
                  unit.coveringCueIdx[0] ?? 0,
                  unitIdx,
                ),
              )
              if (unitEl) unitEl.style.setProperty('--fill', `${unitPct}%`)
            }
            continue
          }

          const cue = cueLine.cues[cueIdx]
          if (!cue) continue
          const duration = Math.max(1, cue.end - cue.start)
          const pct = Math.max(0, Math.min(1, (t - cue.start) / duration))
          const el = wordRefs.current.get(`${lineIdx}|${cueLine.key}|${cueIdx}`)
          if (el) el.style.setProperty('--fill', `${pct * 100}%`)
        }
      }

      // Break dot --fill: linear scan over breaks is fine — N is small (one
      // per gap >= 3s) and most songs have <10 breaks. Same DOM-direct write
      // pattern as cues; only the active dot has .karaoke-fill applied so
      // writes to other dots' --fill are inert.
      let newBreakInfo: { breakKey: string; dotIdx: number } | null = null
      for (const brk of normalized.breaks) {
        if (t < brk.start || t >= brk.end) continue
        const durationPerDot = (brk.end - brk.start) / brk.dotCount
        const dotIdx = Math.min(
          brk.dotCount - 1,
          Math.max(0, Math.floor((t - brk.start) / durationPerDot)),
        )
        newBreakInfo = { breakKey: brk.key, dotIdx }
        const dotStart = brk.start + dotIdx * durationPerDot
        const pct = Math.max(0, Math.min(1, (t - dotStart) / durationPerDot))
        const el = dotRefs.current.get(`${brk.key}|${dotIdx}`)
        if (el) el.style.setProperty('--fill', `${pct * 100}%`)
        break
      }

      const prev = activeBreakInfoRef.current
      if (
        prev?.breakKey !== newBreakInfo?.breakKey ||
        prev?.dotIdx !== newBreakInfo?.dotIdx
      ) {
        activeBreakInfoRef.current = newBreakInfo
        setActiveBreakInfo(newBreakInfo)
      }
    },
    [normalized],
  )

  // 60fps active-index tracking + karaoke wipe tick.
  const {
    activeLineIdx,
    activeLineIndices,
    activeCueByKey,
    lastVisitedCueByKey,
  } = useRafActiveCue({
    lines: normalized.lines,
    getCurrentTimeMs,
    enabled: enabled && normalized.hasWordTiming,
    onTick: handleTick,
  })

  // Cluster anchor (earliest currently-active line index). The scroll effect
  // keys off this value so joiners arriving mid-cluster do NOT re-fire scroll;
  // the first line of the cluster stays anchored per the concurrent-voice spec.
  const scrollAnchorIdx = activeLineIndices[0] ?? -1

  const onWordClick = useWordSeek()

  // Refs for DOM nodes.
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])
  const breakContainerRefs = useRef<Map<string, HTMLDivElement>>(new Map())

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

  // Scroll cluster anchor (first active line) into view when it changes.
  // Joiners arriving mid-cluster don't re-fire scroll because the trigger is
  // scrollAnchorIdx alone.
  useScrollToElementWithRecovery(
    scrollAnchorIdx >= 0 ? scrollAnchorIdx : null,
    scrollContainerRef,
    programmaticScrollRef,
    userScrollGuardRef,
    () => lineRefs.current[scrollAnchorIdx] ?? null,
  )

  // Scroll on break entry only — keyed on breakKey, not dotIdx, so we don't
  // re-scroll on every ~1s dot transition. When activeBreakInfo flips to null
  // at break end, the next line's scroll picks up naturally.
  useScrollToElementWithRecovery(
    activeBreakInfo?.breakKey ?? null,
    scrollContainerRef,
    programmaticScrollRef,
    userScrollGuardRef,
    () =>
      activeBreakInfo
        ? (breakContainerRefs.current.get(activeBreakInfo.breakKey) ?? null)
        : null,
  )

  // Defensive: should never be mounted without word timing, but bail out safely.
  if (!normalized.hasWordTiming) return null

  return (
    <WordLevelLyricsView
      data={normalized}
      activeLineIdx={activeLineIdx}
      activeLineIndices={activeLineIndices}
      activeCueByKey={activeCueByKey}
      lastVisitedCueByKey={lastVisitedCueByKey}
      activeBreakInfo={activeBreakInfo}
      onWordClick={onWordClick}
      resolvedLang={resolvedLang}
      scrollContainerRef={scrollContainerRef}
      lineRefs={lineRefs}
      breakContainerRefs={breakContainerRefs}
      registerWordRef={registerWordRef}
      registerDotRef={registerDotRef}
      rubyUnitsByLineCue={rubyUnitsByLineCue}
    />
  )
}
