import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isSafari } from 'react-device-detect'
import { type RafTickInfo, useRafActiveCue } from '@/hooks/use-raf-active-cue'
import { useWordSeek } from '@/hooks/use-word-seek'
import {
  type RubyUnitLayout,
  resolveUnitLayout,
} from '@/service/furigana/layout'
import { reconcile } from '@/service/furigana/reconcile'
import { resolveSpreadUnitLayout } from '@/service/furigana/spreadLayout'
import {
  computeWipeLayout,
  unitWipePct,
  type WipeLayout,
  wipeFrontChar,
} from '@/service/furigana/wipeFront'
import { useLang } from '@/store/lang.store'
import { usePlayerRef } from '@/store/player.store'
import { type RubyLineModel, rubyUnitKey } from '@/types/furigana'
import type { IStructuredLyric } from '@/types/responses/song'
import { buildRomajiRow, type RomajiItem } from '@/utils/romajiCue'
import { normalizeStructuredLyric } from '@/utils/wordTiming'
import { resolveLyricsLang } from '../lyrics'
import { WordLevelLyricsView } from './view'

const SCROLL_RECOVERY_MS = 1500

// The part of the lyrics box left fully opaque by the
// `maskImage-big-player-lyrics` gradient (tailwind.config.js): 25%–75%.
const CLEAR_BAND_TOP = 0.25
const CLEAR_BAND_BOTTOM = 0.75

// Layout offsets (the scroll box is `relative`, so it is every line's
// offsetParent) — unlike getBoundingClientRect they ignore `scale-125`.
function centeredScrollTop(scrollEl: HTMLElement, el: HTMLElement): number {
  return el.offsetTop + el.offsetHeight / 2 - scrollEl.clientHeight / 2
}

/**
 * scrollTop for the active cluster: center the newest line, but if that pushes
 * the earliest still-sounding line's top above the clear band, scroll less —
 * only as far as keeps the newest line's bottom inside the band (the newest
 * line wins when both can't fit). A single line (first === newest) is centered.
 */
function clusterScrollTop(
  scrollEl: HTMLElement,
  firstEl: HTMLElement,
  newestEl: HTMLElement,
): number {
  const height = scrollEl.clientHeight
  const keepFirstInBand = firstEl.offsetTop - height * CLEAR_BAND_TOP
  const keepNewestInBand =
    newestEl.offsetTop + newestEl.offsetHeight - height * CLEAR_BAND_BOTTOM
  return Math.min(
    centeredScrollTop(scrollEl, newestEl),
    Math.max(keepFirstInBand, keepNewestInBand),
  )
}

// A trigger skipped during the user-scroll pause isn't retried; the next
// line's trigger scrolls again.
function useAutoScroll(
  trigger: unknown,
  scrollContainerRef: React.RefObject<HTMLDivElement>,
  programmaticScrollRef: React.MutableRefObject<boolean>,
  userScrollGuardRef: React.MutableRefObject<{ pausedUntilMs: number }>,
  resolveTop: (scrollEl: HTMLDivElement) => number | null,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger is the explicit driver; it encodes every non-ref value resolveTop reads
  useEffect(() => {
    if (trigger == null) return
    if (performance.now() < userScrollGuardRef.current.pausedUntilMs) return

    const scrollEl = scrollContainerRef.current
    if (!scrollEl) return
    const target = resolveTop(scrollEl)
    if (target == null) return
    const maxTop = scrollEl.scrollHeight - scrollEl.clientHeight
    const top = Math.max(0, Math.min(target, maxTop))

    // Already there, e.g. the cluster's earliest line ended while the newest
    // was centered. A zero-distance scroll fires no `scrollend`, which would
    // leave the programmatic flag stuck and swallow the user's next scroll.
    // (1px tolerance: scrollTop can be fractional on scaled displays.)
    if (Math.abs(top - scrollEl.scrollTop) < 1) return

    programmaticScrollRef.current = true
    scrollEl.scrollTo({ top, behavior: isSafari ? 'auto' : 'smooth' })

    const clearFlag = () => {
      programmaticScrollRef.current = false
    }

    // Smooth scrollTo dispatches async `scroll` events for ~300-500ms;
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
  /**
   * Explicit, pre-computed ruby line models keyed by LINE INDEX (matching
   * `normalized.lines`). Supplied by the caller — this container does NO
   * inference. When absent or a line has no entry, that cueLine renders bare
   * (legacy per-cue wipe, no ruby). The model's line-char coordinates must
   * match each cueLine's `value`; `reconcile()` intersects it with the cues.
   */
  rubyModels?: Map<number, RubyLineModel>
  /** Resolved line-system (romaji) id; forwarded to gate romaji rendering. */
  resolvedLineSystem?: string
  /** Pronunciation track whose per-line `value` renders as a parallel romaji line. */
  romajiLyric?: IStructuredLyric
}

export function WordLevelLyricsContainer({
  structuredLyric,
  enabled = true,
  rubyModels,
  resolvedLineSystem,
  romajiLyric,
}: WordLevelLyricsContainerProps) {
  // Normalise once; re-normalise only when the raw data reference changes.
  const normalized = useMemo(
    () => normalizeStructuredLyric(structuredLyric),
    [structuredLyric],
  )

  // Romaji per-line text keyed by line index, aligned positionally to the main
  // lyric's lines (text only, no timing → no normalization; graceful on mismatch).
  const romajiByLine = useMemo(() => {
    const map = new Map<number, string>()
    if (!romajiLyric) return map
    romajiLyric.line.forEach((line, i) => {
      if (line.value?.trim()) map.set(i, line.value)
    })
    return map
  }, [romajiLyric])

  // Normalised romaji (Latn) track — offset-applied cues for word-level karaoke.
  const romajiNormalized = useMemo(
    () => (romajiLyric ? normalizeStructuredLyric(romajiLyric) : undefined),
    [romajiLyric],
  )

  // Word-level romaji rows keyed by `${lineIdx}|${cueLine.key}` (primary voice).
  // Overlays the romaji track's own cues onto the main cues by start timestamp;
  // spacing is verbatim from the romaji value. When a line yields no row (no
  // word timing) the view falls back to the static per-line romajiByLine.
  const romajiRowsByLineCue = useMemo(() => {
    const map = new Map<string, RomajiItem[]>()
    if (!resolvedLineSystem || !romajiNormalized) return map
    normalized.lines.forEach((line, i) => {
      const mainCueLine = line.cueLines[0]
      if (!mainCueLine) return
      const romajiCueLine = romajiNormalized.lines[i]?.cueLines[0]
      const row = buildRomajiRow(mainCueLine.cues, romajiCueLine)
      if (row.length > 0) map.set(`${i}|${mainCueLine.key}`, row)
    })
    return map
  }, [normalized, romajiNormalized, resolvedLineSystem])

  const { langCode } = useLang()
  const resolvedLang = useMemo(
    () => resolveLyricsLang(normalized.lang, langCode),
    [normalized.lang, langCode],
  )

  // Reconcile the supplied per-line models against each cueLine's cues into
  // render units + a shared-front wipe layout. Keyed by
  // `${lineIdx}|${cueLine.key}` to mirror view.tsx. When no model exists for a
  // line, its cueLines are skipped here and fall back to the legacy per-cue
  // render/wipe path in view.tsx (bare text, no ruby).
  const { rubyLayoutsByLineCue, wipeLayoutsByLineCue } = useMemo(() => {
    const rubyLayouts = new Map<string, RubyUnitLayout>()
    const wipeLayouts = new Map<string, WipeLayout>()
    if (!rubyModels || rubyModels.size === 0) {
      return {
        rubyLayoutsByLineCue: rubyLayouts,
        wipeLayoutsByLineCue: wipeLayouts,
      }
    }
    normalized.lines.forEach((line, i) => {
      const model = rubyModels.get(i)
      if (!model) return
      for (const cueLine of line.cueLines) {
        const key = `${i}|${cueLine.key}`
        // Layout is resolved exactly once here (shift-first collision
        // resolution, including any leftover merges; spread models widen
        // their units instead), so the wipe layout and the render share the
        // same final units AND the same reading groups.
        const units = reconcile(model, cueLine.cues, cueLine.value)
        const layout = model.spread
          ? resolveSpreadUnitLayout(units)
          : resolveUnitLayout(units, cueLine.value)
        rubyLayouts.set(key, layout)
        // Precompute the shared-front char layout once per cueLine, not per frame.
        wipeLayouts.set(
          key,
          computeWipeLayout(layout.units, cueLine.cues.length),
        )
      }
    })
    return {
      rubyLayoutsByLineCue: rubyLayouts,
      wipeLayoutsByLineCue: wipeLayouts,
    }
  }, [normalized, rubyModels])

  // Mirror into refs so the rAF tick reads current units + layout without
  // re-subscribing.
  const rubyLayoutsRef = useRef(rubyLayoutsByLineCue)
  rubyLayoutsRef.current = rubyLayoutsByLineCue
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

  // Per-romaji-token <span> registry, keyed `${lineIdx}|${cueLine.key}|${mainCueIdx}`
  // so handleTick drives each active romaji token's --fill in lockstep with its
  // main cue.
  const romajiRefs = useRef<Map<string, HTMLSpanElement>>(new Map())
  const registerRomajiRef = useCallback(
    (key: string, el: HTMLSpanElement | null) => {
      if (el) romajiRefs.current.set(key, el)
      else romajiRefs.current.delete(key)
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

          // Romaji parallel wipe (independent of the ruby/legacy main path): the
          // active main cue's time-based fill drives its romaji token span.
          const activeMainCue = cueLine.cues[cueIdx]
          if (activeMainCue) {
            const romajiEl = romajiRefs.current.get(
              `${lineIdx}|${cueLine.key}|${cueIdx}`,
            )
            if (romajiEl) {
              const dur = Math.max(1, activeMainCue.end - activeMainCue.start)
              const pct = Math.max(
                0,
                Math.min(1, (t - activeMainCue.start) / dur),
              )
              romajiEl.style.setProperty('--fill', `${pct * 100}%`)
            }
          }

          // Furigana cueLines wipe as ONE shared front per cue: every unit in
          // the active cue (kanji group, bare okurigana, paren, particle) fills
          // only as the front crosses its own char slice, so a cue never shows
          // parallel wipes. Non-furigana cueLines keep the legacy per-cue --fill.
          const units = rubyLayoutsRef.current.get(
            `${lineIdx}|${cueLine.key}`,
          )?.units
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

  // Keyed on the cluster's earliest still-sounding line AND the newest started
  // line: a voice joining mid-cluster re-fires the scroll, as does the earliest
  // line ending. The newest line ending while an earlier one continues changes
  // neither, so the view never scrolls back up.
  const firstActiveIdx = activeLineIndices[0] ?? -1
  const lineScrollKey =
    firstActiveIdx >= 0 ? `${firstActiveIdx}|${activeLineIdx}` : null

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
      // Ignore scroll events caused by our own programmatic scrollTo.
      if (programmaticScrollRef.current) return
      userScrollGuardRef.current.pausedUntilMs =
        performance.now() + SCROLL_RECOVERY_MS
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useAutoScroll(
    lineScrollKey,
    scrollContainerRef,
    programmaticScrollRef,
    userScrollGuardRef,
    (scrollEl) => {
      const firstEl = lineRefs.current[firstActiveIdx] ?? null
      const newestEl = lineRefs.current[activeLineIdx] ?? null
      // A line hidden behind a break has no element; center the other one.
      if (!firstEl || !newestEl) {
        const el = firstEl ?? newestEl
        return el ? centeredScrollTop(scrollEl, el) : null
      }
      return clusterScrollTop(scrollEl, firstEl, newestEl)
    },
  )

  // Scroll on break entry only — keyed on breakKey, not dotIdx, so we don't
  // re-scroll on every ~1s dot transition. When activeBreakInfo flips to null
  // at break end, the next line's scroll picks up naturally.
  useAutoScroll(
    activeBreakInfo?.breakKey ?? null,
    scrollContainerRef,
    programmaticScrollRef,
    userScrollGuardRef,
    (scrollEl) => {
      const el = activeBreakInfo
        ? breakContainerRefs.current.get(activeBreakInfo.breakKey)
        : undefined
      return el ? centeredScrollTop(scrollEl, el) : null
    },
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
      rubyLayoutsByLineCue={rubyLayoutsByLineCue}
      resolvedLineSystem={resolvedLineSystem}
      romajiByLine={romajiByLine}
      romajiRowsByLineCue={romajiRowsByLineCue}
      registerRomajiRef={registerRomajiRef}
    />
  )
}
