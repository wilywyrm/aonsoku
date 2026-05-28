import clsx from 'clsx'
import { isSafari } from 'react-device-detect'
import { byteSliceFallback } from '@/utils/byteSlice'
import type { NormalizedStructuredLyric } from '@/utils/wordTiming'

export interface WordLevelLyricsViewProps {
  data: NormalizedStructuredLyric
  /** -1 when no line is active. */
  activeLineIdx: number
  /** Map from NormalizedCueLine.key → active cue index. Empty Record when no line active. */
  activeCueByKey: Readonly<Record<string, number>>
  /** Called with the cue's normalised (offset-applied) start time in ms. */
  onWordClick: (cueStartMs: number) => void
  /** Result of resolveLyricsLang(data.lang, langCode) — computed by the container. */
  resolvedLang: string | undefined
  /** Forwarded to the outer scroll container so the container can attach a ref. */
  scrollContainerRef?: React.Ref<HTMLDivElement>
  /** Refs for each LINE CONTAINER <div> by line index — for scroll-into-view. */
  lineRefs?: React.MutableRefObject<(HTMLDivElement | null)[]>
}

export function WordLevelLyricsView({
  data,
  activeLineIdx,
  activeCueByKey,
  onWordClick,
  resolvedLang,
  scrollContainerRef,
  lineRefs,
}: WordLevelLyricsViewProps) {
  return (
    <div
      ref={scrollContainerRef}
      data-testid="word-sync-lyrics-box"
      className={clsx(
        'h-full overflow-y-auto',
        !isSafari && 'scroll-smooth',
        'w-full text-center font-semibold text-2xl 2xl:text-3xl px-2 maskImage-big-player-lyrics',
      )}
    >
      {data.lines.map((line, i) => (
        <div
          ref={(el) => {
            if (lineRefs?.current) lineRefs.current[i] = el
          }}
          key={i}
          data-testid={`word-line-${i}`}
          data-active={i === activeLineIdx ? 'true' : 'false'}
          className={clsx(
            'my-5 transition-[opacity] duration-500 motion-reduce:transition-none',
            i === activeLineIdx ? 'opacity-100' : 'opacity-50',
          )}
        >
          {line.cueLines.length === 0 ? (
            <p lang={resolvedLang}>{line.value}</p>
          ) : (
            line.cueLines.map((cueLine) => {
              const activeCueIdxForThisCueLine =
                activeCueByKey[cueLine.key] ?? -1
              return (
                <p
                  key={cueLine.key}
                  lang={resolvedLang}
                  dir="auto"
                  aria-label={cueLine.value}
                  data-testid={`word-line-${i}-cueline-${cueLine.key}`}
                  data-agent-role={cueLine.agentRole ?? 'unknown'}
                  data-display-order={cueLine.displayOrder}
                  className={clsx(
                    'drop-shadow-lg cursor-pointer hover:opacity-100 [word-break:keep-all]',
                    cueLine.displayOrder >= 1 && 'opacity-70',
                    cueLine.displayOrder >= 1 && 'text-sm',
                  )}
                >
                  {/* NOTE: screen-reader fragmentation is a known limitation; role="text" on p partially mitigates it */}
                  {cueLine.cues.map((cue, cueIdx) => {
                    const renderedText = byteSliceFallback(cue, cueLine.value)
                    const isWhitespaceOnly = renderedText.trim().length === 0

                    let cueState: 'past' | 'active' | 'future'
                    if (
                      i < activeLineIdx ||
                      (i === activeLineIdx &&
                        cueIdx < activeCueIdxForThisCueLine)
                    ) {
                      cueState = 'past'
                    } else if (
                      i === activeLineIdx &&
                      cueIdx === activeCueIdxForThisCueLine
                    ) {
                      cueState = 'active'
                    } else {
                      cueState = 'future'
                    }

                    const cueClassName = clsx(
                      'transition-[color,font-weight] duration-150 motion-reduce:transition-none',
                      cueState === 'past' &&
                        i === activeLineIdx &&
                        'opacity-50',
                      cueState === 'active' && 'text-primary font-semibold',
                    )

                    return (
                      <span
                        key={cueIdx}
                        data-testid={`word-${i}-${cueLine.key}-${cueIdx}`}
                        data-state={cueState}
                        aria-hidden={isWhitespaceOnly ? 'true' : undefined}
                        className={cueClassName}
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
                        tabIndex={isWhitespaceOnly ? -1 : 0}
                        style={
                          isWhitespaceOnly
                            ? undefined
                            : {
                                display: 'inline-block',
                                minWidth: '1ch',
                                position: 'relative',
                              }
                        }
                        data-text={renderedText}
                      >
                        {renderedText}
                        {/* Width-reservation sibling — pre-reserves bold width to prevent layout shift (D2) */}
                        {!isWhitespaceOnly && (
                          <span
                            aria-hidden="true"
                            className="font-semibold pointer-events-none"
                            style={{
                              visibility: 'hidden',
                              height: 0,
                              display: 'block',
                            }}
                          >
                            {renderedText}
                          </span>
                        )}
                      </span>
                    )
                  })}
                </p>
              )
            })
          )}
        </div>
      ))}
    </div>
  )
}
