import clsx from 'clsx'
import type { LinkedCue, RomajiItem } from '@/utils/romajiCue'

export interface RomajiCueContentProps {
  items: RomajiItem[]
  lineIdx: number
  cueLineKey: string
  isLineActive: boolean
  activeLineIdx: number
  activeCueIdx: number
  lastVisitedCueIdx: number
  onWordClick: (cueStartMs: number) => void
  registerRomajiRef?: (key: string, el: HTMLSpanElement | null) => void
  hoveredCue?: LinkedCue | null
  onHoverCue?: (cue: LinkedCue | null) => void
}

export function RomajiCueContent({
  items,
  lineIdx,
  cueLineKey,
  isLineActive,
  activeLineIdx,
  activeCueIdx,
  lastVisitedCueIdx,
  onWordClick,
  registerRomajiRef,
  hoveredCue,
  onHoverCue,
}: RomajiCueContentProps) {
  return (
    <>
      {items.map((item, idx) => {
        if (item.kind === 'gap') {
          return (
            <span key={idx} aria-hidden="true" className="romaji-gap">
              {item.text}
            </span>
          )
        }

        let cueState: 'past' | 'active' | 'future'
        if (isLineActive) {
          if (item.mainCueIdx === activeCueIdx) cueState = 'active'
          else if (item.mainCueIdx <= lastVisitedCueIdx) cueState = 'past'
          else cueState = 'future'
        } else if (lineIdx <= activeLineIdx) {
          cueState = 'past'
        } else {
          cueState = 'future'
        }

        const isDim =
          cueState === 'past' ||
          (cueState === 'future' && lineIdx > activeLineIdx)
        const isLinked =
          hoveredCue?.lineIdx === lineIdx &&
          hoveredCue.cueLineKey === cueLineKey &&
          hoveredCue.cueIdx === item.mainCueIdx
        const refKey = `${lineIdx}|${cueLineKey}|${item.mainCueIdx}`

        return (
          <span
            key={idx}
            ref={(el) => registerRomajiRef?.(refKey, el)}
            data-testid={`romaji-word-${lineIdx}-${cueLineKey}-${item.mainCueIdx}`}
            data-state={cueState}
            className={clsx(
              'romaji-word cursor-pointer hover:opacity-100 [word-break:keep-all]',
              isDim && !isLinked && 'opacity-50',
              isLinked && 'cue-linked',
              cueState === 'active' && 'font-semibold karaoke-fill',
            )}
            onClick={(e) => {
              e.stopPropagation()
              onWordClick(item.startMs)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onWordClick(item.startMs)
              }
            }}
            onMouseEnter={() =>
              onHoverCue?.({ lineIdx, cueLineKey, cueIdx: item.mainCueIdx })
            }
            onMouseLeave={() => onHoverCue?.(null)}
            tabIndex={0}
          >
            {item.text}
          </span>
        )
      })}
    </>
  )
}
