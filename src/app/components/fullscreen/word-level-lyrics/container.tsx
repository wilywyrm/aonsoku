import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isSafari } from 'react-device-detect'
import { type RafTickInfo, useRafActiveCue } from '@/hooks/use-raf-active-cue'
import { useWordSeek } from '@/hooks/use-word-seek'
import {
  absorbOkurigana,
  mergeCollidingUnits,
} from '@/service/furigana/grouping'
import { reconcile } from '@/service/furigana/reconcile'
import {
  computeWipeLayout,
  unitWipePct,
  type WipeLayout,
  wipeFrontChar,
} from '@/service/furigana/wipeFront'
import { useLang } from '@/store/lang.store'
import { usePlayerRef } from '@/store/player.store'
import {
  type RenderUnit,
  type RubyLineModel,
  rubyUnitKey,
} from '@/types/furigana'
import type { IStructuredLyric } from '@/types/responses/song'
import { buildRomajiRow, type RomajiItem } from '@/utils/romajiCue'
import { normalizeStructuredLyric } from '@/utils/wordTiming'
import { resolveLyricsLang } from '../lyrics'
import { WordLevelLyricsView } from './view'

const SCROLL_RECOVERY_MS = 1500

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
  const { rubyUnitsByLineCue, wipeLayoutsByLineCue } = useMemo(() => {
    const units = new Map<string, RenderUnit[]>()
    const layouts = new Map<string, WipeLayout>()
    if (!rubyModels || rubyModels.size === 0) {
      return { rubyUnitsByLineCue: units, wipeLayoutsByLineCue: layouts }
    }
    normalized.lines.forEach((line, i) => {
      const model = rubyModels.get(i)
      if (!model) return
      for (const cueLine of line.cueLines) {
        const key = `${i}|${cueLine.key}`
        // Merge adjacent kanji units whose readings would overhang into each
        // other (e.g. 心構えても → 心 + 構え split across cues) so the shared
        // wipe layout and the render agree on one group-ruby unit.
        const u = absorbOkurigana(
          mergeCollidingUnits(reconcile(model, cueLine.cues, cueLine.value)),
        )
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

  // Per-romaji-token <span> registry, keyed `${lineIdx}|${cueLine.key}|${mainCueIdx}`
  // so handleTick drives each active romaji token's --fill in lockstep with its
  // main cue, and the centering effect can measure the active token.
  const romajiRefs = useRef<Map<string, HTMLSpanElement>>(new Map())
  const registerRomajiRef = useCallback(
    (key: string, el: HTMLSpanElement | null) => {
      if (el) romajiRefs.current.set(key, el)
      else romajiRefs.current.delete(key)
    },
    [],
  )

  // Per-cueLine romaji ROW <div> registry, keyed `${lineIdx}|${cueLine.key}` —
  // the element the centering effect slides via translateX.
  const romajiRowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const registerRomajiRowRef = useCallback(
    (key: string, el: HTMLDivElement | null) => {
      if (el) romajiRowRefs.current.set(key, el)
      else romajiRowRefs.current.delete(key)
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

  // Resolve the active MAIN word's DOM node for a cueLine — a reconciled ruby
  // unit covering the cue, else the legacy per-cue span — so romaji centering
  // measures the right element in both render paths.
  const getActiveMainEl = useCallback(
    (lineIdx: number, cueLineKey: string, activeCueIdx: number) => {
      if (activeCueIdx < 0) return undefined
      const units = rubyUnitsByLineCue.get(`${lineIdx}|${cueLineKey}`)
      if (units) {
        for (let unitIdx = 0; unitIdx < units.length; unitIdx++) {
          const u = units[unitIdx]
          if (u.coveringCueIdx.includes(activeCueIdx)) {
            const el = wordRefs.current.get(
              rubyUnitKey(
                lineIdx,
                cueLineKey,
                u.coveringCueIdx[0] ?? 0,
                unitIdx,
              ),
            )
            if (el) return el
          }
        }
        return undefined
      }
      return wordRefs.current.get(`${lineIdx}|${cueLineKey}|${activeCueIdx}`)
    },
    [rubyUnitsByLineCue],
  )

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

  // Slide each active romaji row so its active word centres under the active
  // main word. Self-correcting: the measured viewport delta is converted to the
  // row's local space via its effective scale (which includes the active line's
  // scale-125) and ADDED to the row's current translate, so it converges without
  // a reset flash. Fires only on active-cue changes; the ease lives in CSS.
  const romajiTranslateRef = useRef<Map<string, number>>(new Map())
  useEffect(() => {
    const activeSet =
      activeLineIndices.length > 0
        ? activeLineIndices
        : activeLineIdx >= 0
          ? [activeLineIdx]
          : []
    for (const lineIdx of activeSet) {
      const line = normalized.lines[lineIdx]
      if (!line) continue
      for (const cueLine of line.cueLines) {
        const rowKey = `${lineIdx}|${cueLine.key}`
        const rowEl = romajiRowRefs.current.get(rowKey)
        if (!rowEl) continue
        const activeCueIdx = activeCueByKey[cueLine.key] ?? -1
        const tokenEl =
          activeCueIdx >= 0
            ? romajiRefs.current.get(
                `${lineIdx}|${cueLine.key}|${activeCueIdx}`,
              )
            : undefined
        const mainEl = getActiveMainEl(lineIdx, cueLine.key, activeCueIdx)
        if (!tokenEl || !mainEl) {
          if (romajiTranslateRef.current.get(rowKey)) {
            romajiTranslateRef.current.set(rowKey, 0)
            rowEl.style.transform = 'translateX(0px)'
          }
          continue
        }
        const mainRect = mainEl.getBoundingClientRect()
        const tokenRect = tokenEl.getBoundingClientRect()
        const rowRect = rowEl.getBoundingClientRect()
        const scaleX =
          rowEl.offsetWidth > 0 ? rowRect.width / rowEl.offsetWidth : 1
        const deltaViewport =
          mainRect.left +
          mainRect.width / 2 -
          (tokenRect.left + tokenRect.width / 2)
        const current = romajiTranslateRef.current.get(rowKey) ?? 0
        const next = current + deltaViewport / (scaleX || 1)
        romajiTranslateRef.current.set(rowKey, next)
        rowEl.style.transform = `translateX(${next}px)`
      }
    }
  }, [
    activeCueByKey,
    activeLineIndices,
    activeLineIdx,
    normalized,
    getActiveMainEl,
  ])

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
      resolvedLineSystem={resolvedLineSystem}
      romajiByLine={romajiByLine}
      romajiRowsByLineCue={romajiRowsByLineCue}
      registerRomajiRef={registerRomajiRef}
      registerRomajiRowRef={registerRomajiRowRef}
    />
  )
}
