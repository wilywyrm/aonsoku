import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { applyEntryHeights, LyricsEntry } from './lyrics-entry'

// Minimal stand-in for an observed entry element. Every read and write goes to
// a log shared across entries, so ordering between entries is checkable too.
function fakeEntry(
  name: string,
  log: string[],
  { offsetHeight = 0, measured = false } = {},
) {
  const attributes = new Set(measured ? ['data-measured'] : [])
  return {
    get offsetHeight() {
      log.push(`${name}: read offsetHeight`)
      return offsetHeight
    },
    style: {
      setProperty(property: string, value: string | null) {
        log.push(`${name}: ${property}=${value}`)
      },
    },
    hasAttribute: (attribute: string) => attributes.has(attribute),
    setAttribute(attribute: string) {
      attributes.add(attribute)
      log.push(`${name}: set ${attribute}`)
    },
  }
}

describe('applyEntryHeights', () => {
  it('writes the observed border-box height as --lyrics-entry-height', () => {
    const log: string[] = []
    const entry = fakeEntry('a', log, { measured: true })
    applyEntryHeights([{ target: entry, borderBoxSize: [{ blockSize: 87.5 }] }])
    expect(log).toEqual(['a: --lyrics-entry-height=87.5px'])
  })

  it('falls back to offsetHeight when the engine has no borderBoxSize', () => {
    const log: string[] = []
    const entry = fakeEntry('a', log, { offsetHeight: 42, measured: true })
    applyEntryHeights([{ target: entry }])
    expect(log).toEqual([
      'a: read offsetHeight',
      'a: --lyrics-entry-height=42px',
    ])
  })

  it('flushes first heights once, before marking those entries measured', () => {
    const log: string[] = []
    applyEntryHeights([
      { target: fakeEntry('a', log), borderBoxSize: [{ blockSize: 10 }] },
      {
        target: fakeEntry('b', log, { measured: true }),
        borderBoxSize: [{ blockSize: 20 }],
      },
      { target: fakeEntry('c', log), borderBoxSize: [{ blockSize: 30 }] },
    ])
    expect(log).toEqual([
      'a: --lyrics-entry-height=10px',
      'b: --lyrics-entry-height=20px',
      'c: --lyrics-entry-height=30px',
      'a: read offsetHeight',
      'a: set data-measured',
      'c: set data-measured',
    ])
  })
})

describe('LyricsEntry', () => {
  it('renders an entry that is focused only when asked', () => {
    expect(
      renderToStaticMarkup(
        <LyricsEntry focused={false} className="w-fit">
          a
        </LyricsEntry>,
      ),
    ).toBe('<div class="lyrics-entry w-fit">a</div>')
    expect(
      renderToStaticMarkup(
        <LyricsEntry focused data-testid="word-line-0">
          a
        </LyricsEntry>,
      ),
    ).toBe(
      '<div class="lyrics-entry is-focused" data-testid="word-line-0">a</div>',
    )
  })
})
