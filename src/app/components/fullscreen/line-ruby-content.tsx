import { useMemo } from 'react'
import { buildLineRenderSpans } from '@/service/furigana/lineRuby'
import type { RubyLineModel } from '@/types/furigana'

interface LineRubyContentProps {
  text: string
  model?: RubyLineModel
}

export function LineRubyContent({ text, model }: LineRubyContentProps) {
  const spans = useMemo(() => buildLineRenderSpans(text, model), [text, model])

  return (
    <>
      {spans.map((span, idx) => {
        // Bare span: no kana, no cells — render as plain text
        if (span.kana === undefined) {
          return span.text
        }

        // Ruby span with cells (splittable)
        if (span.cells !== undefined) {
          return (
            <span key={idx} className="ruby-unit" data-testid="line-ruby-unit">
              <span className="ruby-base">{span.text}</span>
              <span className="ruby-furi" aria-hidden="true">
                {span.cells.map((cell, ci) =>
                  cell.kana !== undefined ? (
                    <span key={ci} className="ruby-furi-cell">
                      <span className="ruby-furi-spacer">{cell.text}</span>
                      <span className="ruby-furi-rt">{cell.kana}</span>
                    </span>
                  ) : (
                    <span key={ci} className="ruby-furi-gap">{cell.text}</span>
                  ),
                )}
              </span>
            </span>
          )
        }

        // Ruby span without cells (jukujikun)
        return (
          <span key={idx} className="ruby-unit" data-testid="line-ruby-unit">
            <span className="ruby-base">{span.text}</span>
            <span className="ruby-furi" aria-hidden="true">
              <span className="ruby-furi-cell">
                <span className="ruby-furi-spacer">{span.text}</span>
                <span className="ruby-furi-rt">{span.kana}</span>
              </span>
            </span>
          </span>
        )
      })}
    </>
  )
}
