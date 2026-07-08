import clsx from 'clsx'
import type { ReactNode } from 'react'
import { type RenderUnit, rubyUnitKey, rubyUnitTestId } from '@/types/furigana'
import type { NormalizedCueLine } from '@/utils/wordTiming'

const SECONDARY_AGENT_HUE_ROTATIONS = [180, 90, 270, 45, 135, 225, 315] as const

function rubyContent(unit: RenderUnit): ReactNode {
  if (!unit.kana) return unit.kanjiText

  if (!unit.perKanji || unit.perKanji.length === 0) {
    return (
      <ruby>
        {unit.kanjiText}
        <rt>{unit.kana}</rt>
      </ruby>
    )
  }

  const parts: ReactNode[] = []
  let local = 0
  unit.perKanji.forEach((pk, idx) => {
    const start = pk.charStart - unit.charStart
    const end = pk.charEnd - unit.charStart
    if (start > local) parts.push(unit.kanjiText.slice(local, start))
    parts.push(
      <ruby key={idx}>
        {unit.kanjiText.slice(start, end + 1)}
        <rt>{pk.kana}</rt>
      </ruby>,
    )
    local = end + 1
  })
  if (local < unit.kanjiText.length) parts.push(unit.kanjiText.slice(local))
  return parts
}

export interface RubyCueContentProps {
  units: RenderUnit[]
  lineIdx: number
  cueLine: NormalizedCueLine
  isLineActive: boolean
  activeLineIdx: number
  activeCueIdx: number
  lastVisitedCueIdx: number
  onWordClick: (cueStartMs: number) => void
  registerWordRef?: (key: string, el: HTMLSpanElement | null) => void
}

export function RubyCueContent({
  units,
  lineIdx,
  cueLine,
  isLineActive,
  activeLineIdx,
  activeCueIdx,
  lastVisitedCueIdx,
  onWordClick,
  registerWordRef,
}: RubyCueContentProps) {
  return (
    <>
      {units.map((unit, unitIdx) => {
        const covering = unit.coveringCueIdx
        const firstCue = covering[0] ?? 0
        const lastCue = covering[covering.length - 1] ?? 0

        let unitState: 'past' | 'active' | 'future'
        if (isLineActive) {
          if (covering.includes(activeCueIdx)) unitState = 'active'
          else if (lastCue <= lastVisitedCueIdx) unitState = 'past'
          else unitState = 'future'
        } else if (lineIdx <= activeLineIdx) {
          unitState = 'past'
        } else {
          unitState = 'future'
        }

        const isWhitespaceOnly = unit.kanjiText.trim().length === 0
        const isDim =
          unitState === 'past' ||
          (unitState === 'future' && lineIdx > activeLineIdx)
        const hueRotation =
          unitState === 'active' && cueLine.displayOrder >= 1
            ? SECONDARY_AGENT_HUE_ROTATIONS[
                (cueLine.displayOrder - 1) %
                  SECONDARY_AGENT_HUE_ROTATIONS.length
              ]
            : undefined

        const key = rubyUnitKey(lineIdx, cueLine.key, firstCue, unitIdx)
        const cueStart = cueLine.cues[firstCue]?.start ?? 0

        return (
          <span
            key={unitIdx}
            ref={(el) => registerWordRef?.(key, el)}
            data-testid={rubyUnitTestId(
              lineIdx,
              cueLine.key,
              firstCue,
              unitIdx,
            )}
            data-state={unitState}
            aria-hidden={isWhitespaceOnly ? 'true' : undefined}
            className={clsx(
              !isWhitespaceOnly &&
                'cursor-pointer hover:opacity-100 [word-break:keep-all]',
              isDim && 'opacity-50',
              unitState === 'active' && 'font-semibold',
              unitState === 'active' &&
                !unit.kana &&
                !isWhitespaceOnly &&
                'karaoke-fill',
            )}
            style={
              hueRotation !== undefined
                ? { filter: `hue-rotate(${hueRotation}deg)` }
                : undefined
            }
            onClick={(e) => {
              e.stopPropagation()
              onWordClick(cueStart)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onWordClick(cueStart)
              }
            }}
            tabIndex={isWhitespaceOnly ? -1 : 0}
          >
            {unit.kana ? (
              <span className="ruby-unit-wrapper">
                <span className="ruby-unit-base">{rubyContent(unit)}</span>
                {unitState === 'active' && (
                  <span className="ruby-unit-fill" aria-hidden="true">
                    {rubyContent(unit)}
                  </span>
                )}
              </span>
            ) : (
              rubyContent(unit)
            )}
          </span>
        )
      })}
    </>
  )
}
