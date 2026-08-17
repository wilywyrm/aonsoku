import clsx from 'clsx'
import type { CSSProperties, ReactNode } from 'react'
import { groupReadings } from '@/service/furigana/grouping'
import { type RenderUnit, rubyUnitKey, rubyUnitTestId } from '@/types/furigana'
import type { NormalizedCueLine } from '@/utils/wordTiming'

const SECONDARY_AGENT_HUE_ROTATIONS = [180, 90, 270, 45, 135, 225, 315] as const

// --seg-start/--seg-span position a reading's wipe within the unit's shared
// --fill front (index.css remaps them into a per-reading --local-fill).
function segStyle(start: number, span: number, total: number): CSSProperties {
  return {
    '--seg-start': `${(start / total) * 100}%`,
    '--seg-span': `${span / total}`,
  } as CSSProperties
}

// Furigana overlay for one kanji unit: readings floated ABOVE the flat
// .ruby-base copy in a separate absolutely-positioned layer, so a reading
// overhangs without widening the base (kanji stay flush) and the base glyphs
// are never duplicated. Hidden spacers reproduce the base layout so each
// reading aligns without pixel measurement.
function renderFuriCells(unit: RenderUnit): ReactNode {
  const text = unit.kanjiText
  const total = text.length

  // Jukujikun (non-splittable): one reading centred over the whole group.
  if (!unit.perKanji || unit.perKanji.length === 0) {
    return (
      <span className="ruby-furi-cell">
        <span className="ruby-furi-spacer">{text}</span>
        <span className="ruby-furi-rt" style={segStyle(0, total, total)}>
          {unit.kana}
        </span>
      </span>
    )
  }

  const groups = groupReadings(unit.perKanji, unit.charStart)
  const cells: ReactNode[] = []
  let local = 0
  groups.forEach((g, idx) => {
    // Okurigana / non-kanji gap: a hidden spacer keeps the overlay aligned with
    // the base but carries no reading.
    if (g.start > local) {
      cells.push(
        <span key={`gap-${idx}`} className="ruby-furi-gap">
          {text.slice(local, g.start)}
        </span>,
      )
    }
    cells.push(
      <span key={idx} className="ruby-furi-cell">
        <span className="ruby-furi-spacer">
          {text.slice(g.start, g.end + 1)}
        </span>
        <span
          className="ruby-furi-rt"
          style={segStyle(g.start, g.end - g.start + 1, total)}
        >
          {g.kana}
        </span>
      </span>,
    )
    local = g.end + 1
  })
  if (local < total) {
    cells.push(
      <span key="gap-tail" className="ruby-furi-gap">
        {text.slice(local)}
      </span>,
    )
  }
  return cells
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
              <span className="ruby-unit">
                <span className="ruby-base">{unit.kanjiText}</span>
                <span className="ruby-furi" aria-hidden="true">
                  {renderFuriCells(unit)}
                </span>
              </span>
            ) : (
              unit.kanjiText
            )}
          </span>
        )
      })}
    </>
  )
}
