import clsx from 'clsx'
import type { CSSProperties, ReactNode } from 'react'
import { type RenderUnit, rubyUnitKey, rubyUnitTestId } from '@/types/furigana'
import type { NormalizedCueLine } from '@/utils/wordTiming'

const SECONDARY_AGENT_HUE_ROTATIONS = [180, 90, 270, 45, 135, 225, 315] as const

// Furigana annotation size as a fraction of the base glyph (MUST match
// .ruby-furi-rt font-size in index.css). CJK base glyphs are full-width (1em)
// and each kana reading char is RT_EM em, so a reading's natural width is
// kana.length * RT_EM em — the basis for the collision test below.
const RT_EM = 0.5

// Minimum horizontal gap (em) kept between two adjacent readings; if their
// natural widths would leave less than this, they are merged into one group.
const READING_GAP_EM = 0.1

interface ReadingGroup {
  start: number // unit-local char index of the group's first kanji
  end: number // unit-local char index of the group's last kanji (inclusive)
  kana: string // combined reading, centred over the whole group
}

// A reading is centred over its kanji span and may overhang it. Two adjacent
// readings collide when the earlier one's right edge (plus a small gap) passes
// the next one's left edge. All quantities are em (1 em per base char).
function readingsCollide(a: ReadingGroup, b: ReadingGroup): boolean {
  const spanCentre = (g: ReadingGroup) => (g.start + g.end + 1) / 2
  const half = (g: ReadingGroup) => (g.kana.length * RT_EM) / 2
  return spanCentre(a) + half(a) + READING_GAP_EM > spanCentre(b) - half(b)
}

// Per-kanji readings, but any run of adjacent readings that would overhang into
// each other is merged so the combined reading centres over the whole kanji
// group (group-ruby) instead of overlapping. Kanji never move (flush); only the
// reading grouping changes. Merging is transitive: a widened group is re-tested
// against the next reading.
function groupReadings(
  perKanji: NonNullable<RenderUnit['perKanji']>,
  unitStart: number,
): ReadingGroup[] {
  const groups: ReadingGroup[] = []
  for (const pk of perKanji) {
    const next: ReadingGroup = {
      start: pk.charStart - unitStart,
      end: pk.charEnd - unitStart,
      kana: pk.kana,
    }
    const prev = groups[groups.length - 1]
    if (prev && readingsCollide(prev, next)) {
      prev.end = next.end
      prev.kana += next.kana
    } else {
      groups.push(next)
    }
  }
  return groups
}

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
