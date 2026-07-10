import clsx from 'clsx'
import type { CSSProperties, ReactNode } from 'react'
import { type RenderUnit, rubyUnitKey, rubyUnitTestId } from '@/types/furigana'
import type { NormalizedCueLine } from '@/utils/wordTiming'

const SECONDARY_AGENT_HUE_ROTATIONS = [180, 90, 270, 45, 135, 225, 315] as const

// Furigana overlay cells for one kanji unit. Rendered ABOVE the flat .ruby-base
// copy in a separate absolutely-positioned layer, so the reading never widens
// the base (kanji stay flush) and the base glyphs are never duplicated.
//
// Each reading carries two static CSS vars consumed by the karaoke wipe:
//   --seg-start  this kanji's char offset as a % of the unit's width
//   --seg-span   this kanji's char width as a fraction of the unit's width
// The unit-level --fill (written per frame) plus these derive a per-reading
// --local-fill in CSS, so every reading wipes in lockstep with the kanji below.
function renderFuriCells(unit: RenderUnit): ReactNode {
  const text = unit.kanjiText
  const total = text.length

  // Jukujikun (non-splittable): one reading floated over the whole group.
  if (!unit.perKanji || unit.perKanji.length === 0) {
    return (
      <span className="ruby-furi-cell">
        <span className="ruby-furi-spacer">{text}</span>
        <span
          className="ruby-furi-rt"
          style={{ '--seg-start': '0%', '--seg-span': '1' } as CSSProperties}
        >
          {unit.kana}
        </span>
      </span>
    )
  }

  const cells: ReactNode[] = []
  let local = 0
  unit.perKanji.forEach((pk, idx) => {
    const start = pk.charStart - unit.charStart
    const end = pk.charEnd - unit.charStart
    // Okurigana / non-kanji gap: a hidden spacer keeps the overlay aligned with
    // the base but carries no reading.
    if (start > local) {
      cells.push(
        <span key={`gap-${idx}`} className="ruby-furi-gap">
          {text.slice(local, start)}
        </span>,
      )
    }
    const segStart = (start / total) * 100
    const segSpan = (end + 1 - start) / total
    cells.push(
      <span key={idx} className="ruby-furi-cell">
        <span className="ruby-furi-spacer">{text.slice(start, end + 1)}</span>
        <span
          className="ruby-furi-rt"
          style={
            {
              '--seg-start': `${segStart}%`,
              '--seg-span': `${segSpan}`,
            } as CSSProperties
          }
        >
          {pk.kana}
        </span>
      </span>,
    )
    local = end + 1
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
