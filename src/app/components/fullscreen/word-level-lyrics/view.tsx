import clsx from 'clsx'
import { Fragment, useMemo, useState } from 'react'
import { isSafari } from 'react-device-detect'
import type { RenderUnit } from '@/types/furigana'
import { byteSliceFallback } from '@/utils/byteSlice'
import type { LinkedCue, RomajiItem } from '@/utils/romajiCue'
import type {
  NormalizedBreak,
  NormalizedStructuredLyric,
} from '@/utils/wordTiming'
import { RomajiCueContent } from './romaji-cue-content'
import { RubyCueContent } from './ruby-cue-content'

const SECONDARY_AGENT_HUE_ROTATIONS = [180, 90, 270, 45, 135, 225, 315] as const

export interface WordLevelLyricsViewProps {
  data: NormalizedStructuredLyric
  /** -1 when no line has started; else the rightmost-started line index (back-compat anchor for past/future boundary). */
  activeLineIdx: number
  /** Asc-sorted indices of all currently-overlapping (cluster) lines. Optional; defaults to [activeLineIdx] when omitted, preserving single-line behaviour for existing callers. */
  activeLineIndices?: ReadonlyArray<number>
  /** Map from NormalizedCueLine.key → active cue index. Aggregated across every line in activeLineIndices. */
  activeCueByKey: Readonly<Record<string, number>>
  /**
   * Map from NormalizedCueLine.key → greatest cue index whose start time has
   * passed. Stays populated during inter-cue gaps and between-line transitions
   * so previously-visited words keep their `opacity-50` past styling instead
   * of snapping back to the future state.
   */
  lastVisitedCueByKey: Readonly<Record<string, number>>
  /** Non-null when an instrumental break is currently active. Defaults to null. */
  activeBreakInfo?: { breakKey: string; dotIdx: number } | null
  /** Called with the cue's normalised (offset-applied) start time in ms. */
  onWordClick: (cueStartMs: number) => void
  /** Result of resolveLyricsLang(data.lang, langCode) — computed by the container. */
  resolvedLang: string | undefined
  /** Forwarded to the outer scroll container so the container can attach a ref. */
  scrollContainerRef?: React.Ref<HTMLDivElement>
  /** Refs for each LINE CONTAINER <div> by line index — for scroll-into-view. */
  lineRefs?: React.MutableRefObject<(HTMLDivElement | null)[]>
  /** Refs for each BREAK CONTAINER <div> by break.key — for scroll-into-view. */
  breakContainerRefs?: React.MutableRefObject<Map<string, HTMLDivElement>>
  /**
   * Called on mount with the cue <span> element and on unmount with null, keyed
   * by `${lineIdx}|${cueLine.key}|${cueIdx}`. The container uses this to drive
   * the karaoke `--fill` CSS variable directly on each span via rAF, bypassing
   * React state updates so the smooth fill animation doesn't cost re-renders.
   */
  registerWordRef?: (key: string, el: HTMLSpanElement | null) => void
  /**
   * Same DOM-direct --fill pattern as registerWordRef but for break dots,
   * keyed by `${break.key}|${dotIdx}`.
   */
  registerDotRef?: (key: string, el: HTMLSpanElement | null) => void
  /**
   * Per-cueLine reconciled furigana render units, keyed by
   * `${lineIdx}|${cueLine.key}`. Present only for Japanese cueLines whose
   * analysis has resolved; that cueLine then renders per-unit (ruby + two-layer
   * wipe). Absent → the legacy per-cue path renders unchanged.
   */
  rubyUnitsByLineCue?: ReadonlyMap<string, RenderUnit[]>
  /**
   * Resolved line-system (romaji) id. When defined, each cue row renders a
   * parallel `.romaji-cue` line beneath it. Undefined → no romaji.
   */
  resolvedLineSystem?: string
  /** Romaji line text keyed by line index (pronunciation track's per-line value). */
  romajiByLine?: ReadonlyMap<number, string>
  /**
   * Word-level romaji rows keyed `${lineIdx}|${cueLine.key}`. When present for a
   * cueLine, the parallel romaji renders as karaoke words (wipe/hover/seek/focus)
   * instead of the static `.romaji-cue` line.
   */
  romajiRowsByLineCue?: ReadonlyMap<string, RomajiItem[]>
  /** Registers each romaji word <span> for the container's rAF --fill writes. */
  registerRomajiRef?: (key: string, el: HTMLSpanElement | null) => void
  /** Registers each romaji ROW <div> for the horizontal centering transform. */
  registerRomajiRowRef?: (key: string, el: HTMLDivElement | null) => void
}

export function WordLevelLyricsView({
  data,
  activeLineIdx,
  activeLineIndices,
  activeCueByKey,
  lastVisitedCueByKey,
  activeBreakInfo = null,
  onWordClick,
  resolvedLang,
  scrollContainerRef,
  lineRefs,
  breakContainerRefs,
  registerWordRef,
  registerDotRef,
  rubyUnitsByLineCue,
  resolvedLineSystem,
  romajiByLine,
  romajiRowsByLineCue,
  registerRomajiRef,
  registerRomajiRowRef,
}: WordLevelLyricsViewProps) {
  const [hoveredCue, setHoveredCue] = useState<LinkedCue | null>(null)
  const breaksByLine = new Map<number, NormalizedBreak>()
  for (const brk of data.breaks) {
    breaksByLine.set(brk.beforeLineIndex, brk)
  }
  const isBreakActive = activeBreakInfo !== null
  // Cluster membership set: when activeLineIndices is provided and non-empty
  // we use it directly; otherwise fall back to [activeLineIdx] so existing
  // single-index callers (tests, single-track lyrics) keep working unchanged.
  const activeIndicesSet = useMemo<ReadonlySet<number>>(() => {
    if (activeLineIndices && activeLineIndices.length > 0) {
      return new Set(activeLineIndices)
    }
    return activeLineIdx >= 0 ? new Set([activeLineIdx]) : new Set<number>()
  }, [activeLineIndices, activeLineIdx])

  // Empty-text "clear marker" lines are hidden ONLY when a break replaces
  // them — otherwise they stay visible. Sub-threshold (<3s) gaps emit no
  // break, so the blank line remains as the only "lyrics ended" signal.
  // Trailing tombstones likewise stay visible (computeBreaks emits no
  // outro break).
  const hiddenLineIndices = useMemo<ReadonlySet<number>>(() => {
    if (data.breaks.length === 0) return new Set<number>()
    const hidden = new Set<number>()
    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i]
      if (line.cueLines.length > 0) continue
      if (line.value !== '') continue
      if (line.start == null) continue
      for (const brk of data.breaks) {
        if (line.start >= brk.start && line.start < brk.end) {
          hidden.add(i)
          break
        }
      }
    }
    return hidden
  }, [data.breaks, data.lines])

  return (
    <div
      ref={scrollContainerRef}
      data-testid="word-sync-lyrics-box"
      className={clsx(
        'w-full h-full text-center font-semibold text-2xl 2xl:text-3xl px-2 overflow-y-auto',
        !isSafari && 'scroll-smooth',
        'lrc-box maskImage-big-player-lyrics',
      )}
    >
      <div aria-hidden="true" style={{ height: '50%' }} />
      {data.lines.map((line, i) => {
        const precedingBreak = breaksByLine.get(i)
        const isHidden = hiddenLineIndices.has(i)
        return (
          <Fragment key={i}>
            {precedingBreak && (
              <InstrumentalBreak
                brk={precedingBreak}
                isActive={precedingBreak.key === activeBreakInfo?.breakKey}
                activeDotIdx={activeBreakInfo?.dotIdx ?? -1}
                onSeek={onWordClick}
                registerDotRef={registerDotRef}
                containerRef={(el) => {
                  const map = breakContainerRefs?.current
                  if (!map) return
                  if (el) map.set(precedingBreak.key, el)
                  else map.delete(precedingBreak.key)
                }}
              />
            )}
            {!isHidden && (
              <div
                ref={(el) => {
                  if (lineRefs?.current) lineRefs.current[i] = el
                }}
                data-testid={`word-line-${i}`}
                data-active={activeIndicesSet.has(i) ? 'true' : 'false'}
                className={clsx(
                  'drop-shadow-lg my-5 duration-500 w-fit m-auto max-w-[80%] text-balance',
                  'transition-[transform] motion-reduce:transition-none',
                  activeIndicesSet.has(i) && !isBreakActive && 'scale-125',
                )}
              >
                {line.cueLines.length === 0 ? (
                  <p lang={resolvedLang}>{line.value}</p>
                ) : (
                  line.cueLines.map((cueLine) => {
                    const activeCueIdxForThisCueLine =
                      activeCueByKey[cueLine.key] ?? -1
                    const lastVisitedCueIdxForThisCueLine =
                      lastVisitedCueByKey[cueLine.key] ?? -1
                    const rubyUnits = rubyUnitsByLineCue?.get(
                      `${i}|${cueLine.key}`,
                    )
                    const romajiValue = resolvedLineSystem
                      ? romajiByLine?.get(i)
                      : undefined
                    const romajiRow = resolvedLineSystem
                      ? romajiRowsByLineCue?.get(`${i}|${cueLine.key}`)
                      : undefined
                    return (
                      <p
                        key={cueLine.key}
                        lang={resolvedLang}
                        dir="auto"
                        data-testid={`word-line-${i}-cueline-${cueLine.key}`}
                        data-agent-role={cueLine.agentRole ?? 'unknown'}
                        data-display-order={cueLine.displayOrder}
                      >
                        {rubyUnits ? (
                          <RubyCueContent
                            units={rubyUnits}
                            lineIdx={i}
                            cueLine={cueLine}
                            isLineActive={activeIndicesSet.has(i)}
                            activeLineIdx={activeLineIdx}
                            activeCueIdx={activeCueIdxForThisCueLine}
                            lastVisitedCueIdx={lastVisitedCueIdxForThisCueLine}
                            onWordClick={onWordClick}
                            registerWordRef={registerWordRef}
                            hoveredCue={hoveredCue}
                            onHoverCue={setHoveredCue}
                          />
                        ) : (
                          cueLine.cues.map((cue, cueIdx) => {
                            const renderedText = byteSliceFallback(
                              cue,
                              cueLine.value,
                            )
                            const isWhitespaceOnly =
                              renderedText.trim().length === 0

                            let cueState: 'past' | 'active' | 'future'
                            if (activeIndicesSet.has(i)) {
                              if (cueIdx === activeCueIdxForThisCueLine) {
                                cueState = 'active'
                              } else if (
                                cueIdx <= lastVisitedCueIdxForThisCueLine
                              ) {
                                cueState = 'past'
                              } else {
                                cueState = 'future'
                              }
                            } else if (i <= activeLineIdx) {
                              // `<=`, not `<`: catches the rightmost-started line when it has ended while an earlier concurrent line keeps going (i === activeLineIdx AND not in active set).
                              cueState = 'past'
                            } else {
                              cueState = 'future'
                            }

                            const hueRotation =
                              cueState === 'active' && cueLine.displayOrder >= 1
                                ? SECONDARY_AGENT_HUE_ROTATIONS[
                                    (cueLine.displayOrder - 1) %
                                      SECONDARY_AGENT_HUE_ROTATIONS.length
                                  ]
                                : undefined
                            const isDim =
                              cueState === 'past' ||
                              (cueState === 'future' && i > activeLineIdx)
                            const isCueLinked =
                              !isWhitespaceOnly &&
                              hoveredCue?.lineIdx === i &&
                              hoveredCue.cueLineKey === cueLine.key &&
                              hoveredCue.cueIdx === cueIdx
                            const cueClassName = clsx(
                              !isWhitespaceOnly &&
                                'cursor-pointer hover:opacity-100 [word-break:keep-all]',
                              isDim && !isCueLinked && 'opacity-50',
                              isCueLinked && 'cue-linked',
                              cueState === 'active' && 'font-semibold',
                              cueState === 'active' &&
                                !isWhitespaceOnly &&
                                'karaoke-fill',
                            )
                            const wordKey = `${i}|${cueLine.key}|${cueIdx}`

                            return (
                              <span
                                key={cueIdx}
                                ref={(el) => registerWordRef?.(wordKey, el)}
                                data-testid={`word-${i}-${cueLine.key}-${cueIdx}`}
                                data-state={cueState}
                                aria-hidden={
                                  isWhitespaceOnly ? 'true' : undefined
                                }
                                className={cueClassName}
                                style={
                                  hueRotation !== undefined
                                    ? {
                                        filter: `hue-rotate(${hueRotation}deg)`,
                                      }
                                    : undefined
                                }
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onWordClick(cue.start)
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    onWordClick(cue.start)
                                  }
                                }}
                                onMouseEnter={
                                  isWhitespaceOnly
                                    ? undefined
                                    : () =>
                                        setHoveredCue({
                                          lineIdx: i,
                                          cueLineKey: cueLine.key,
                                          cueIdx,
                                        })
                                }
                                onMouseLeave={
                                  isWhitespaceOnly
                                    ? undefined
                                    : () => setHoveredCue(null)
                                }
                                tabIndex={isWhitespaceOnly ? -1 : 0}
                              >
                                {renderedText}
                              </span>
                            )
                          })
                        )}
                        {resolvedLineSystem &&
                          (romajiRow && romajiRow.length > 0 ? (
                            <div
                              ref={(el) =>
                                registerRomajiRowRef?.(
                                  `${i}|${cueLine.key}`,
                                  el,
                                )
                              }
                              className="romaji-row transition-[transform] duration-500 motion-reduce:transition-none"
                              lang={resolvedLineSystem}
                              data-testid={`romaji-row-${i}-${cueLine.key}`}
                            >
                              <RomajiCueContent
                                items={romajiRow}
                                lineIdx={i}
                                cueLineKey={cueLine.key}
                                isLineActive={activeIndicesSet.has(i)}
                                activeLineIdx={activeLineIdx}
                                activeCueIdx={activeCueIdxForThisCueLine}
                                lastVisitedCueIdx={
                                  lastVisitedCueIdxForThisCueLine
                                }
                                onWordClick={onWordClick}
                                registerRomajiRef={registerRomajiRef}
                                hoveredCue={hoveredCue}
                                onHoverCue={setHoveredCue}
                              />
                            </div>
                          ) : (
                            romajiValue && (
                              <span
                                className="romaji-cue"
                                lang={resolvedLineSystem}
                                data-testid={`romaji-cue-${i}-${cueLine.key}`}
                                style={{
                                  opacity: activeIndicesSet.has(i) ? 1 : 0.5,
                                }}
                              >
                                {romajiValue}
                              </span>
                            )
                          ))}
                      </p>
                    )
                  })
                )}
              </div>
            )}
          </Fragment>
        )
      })}
      {/* Bottom spacer mirrors react-lrc's verticalSpace=true — lets the last line scroll to center */}
      <div aria-hidden="true" style={{ height: '50%' }} />
    </div>
  )
}

function InstrumentalBreak({
  brk,
  isActive,
  activeDotIdx,
  onSeek,
  registerDotRef,
  containerRef,
}: {
  brk: NormalizedBreak
  isActive: boolean
  activeDotIdx: number
  onSeek: (timeMs: number) => void
  registerDotRef?: (key: string, el: HTMLSpanElement | null) => void
  containerRef?: (el: HTMLDivElement | null) => void
}) {
  const durationPerDot = (brk.end - brk.start) / brk.dotCount
  return (
    <div
      ref={containerRef}
      data-testid={`instrumental-break-${brk.key}`}
      data-active={isActive ? 'true' : 'false'}
      className={clsx(
        'drop-shadow-lg my-5 duration-500 w-fit m-auto',
        'transition-[transform] motion-reduce:transition-none',
        isActive && 'scale-125',
      )}
    >
      <p className="flex flex-wrap items-center justify-center text-2xl 2xl:text-3xl font-semibold leading-none">
        {Array.from({ length: brk.dotCount }, (_, idx) => {
          const dotKey = `${brk.key}|${idx}`
          const dotStartMs = brk.start + idx * durationPerDot
          const isActiveDot = isActive && idx === activeDotIdx
          // Breaks <=5 dots: all spaced. Breaks >5 dots: only the LAST 5 dots
          // get spacing (pack the silence as a dense block, space the final
          // countdown). idx>0 guards the first dot from a leading margin.
          const isInSpacedZone = brk.dotCount <= 5 || idx >= brk.dotCount - 5
          return (
            <span
              key={idx}
              ref={(el) => registerDotRef?.(dotKey, el)}
              data-testid={`instrumental-break-${brk.key}-dot-${idx}`}
              data-state={isActiveDot ? 'active' : 'inactive'}
              role="button"
              aria-label={`Seek to ${Math.round(dotStartMs / 1000)} seconds`}
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onSeek(dotStartMs)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSeek(dotStartMs)
                }
              }}
              className={clsx(
                'cursor-pointer hover:opacity-100',
                isInSpacedZone && idx > 0 && 'ml-3',
                !isActiveDot && 'opacity-50',
                isActiveDot && 'karaoke-fill',
              )}
            >
              ·
            </span>
          )
        })}
      </p>
    </div>
  )
}
