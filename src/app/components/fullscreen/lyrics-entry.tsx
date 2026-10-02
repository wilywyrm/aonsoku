import clsx from 'clsx'
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
} from 'react'

const MEASURED_ATTR = 'data-measured'

interface EntryHeightTarget {
  readonly offsetHeight: number
  readonly style: Pick<CSSStyleDeclaration, 'setProperty'>
  hasAttribute(name: string): boolean
  setAttribute(name: string, value: string): void
}

interface EntryHeightRecord {
  readonly target: EntryHeightTarget
  readonly borderBoxSize?: ReadonlyArray<{ readonly blockSize: number }>
}

/**
 * Write each entry's untransformed height to `--lyrics-entry-height`, which
 * index.css uses to reserve the focus scale's overflow in layout. Both sources
 * ignore transforms, so a focused (scaled) entry reports its natural height.
 *
 * An entry's first height must land without animating: margins only
 * transition once `[data-measured]` is set, so styles are flushed in between —
 * otherwise a focused entry's reservation would ease in on mount and slide its
 * neighbours.
 */
export function applyEntryHeights(records: Iterable<EntryHeightRecord>) {
  const firstMeasured: EntryHeightTarget[] = []
  for (const { target, borderBoxSize } of records) {
    const height = borderBoxSize?.[0]?.blockSize ?? target.offsetHeight
    target.style.setProperty('--lyrics-entry-height', `${height}px`)
    if (!target.hasAttribute(MEASURED_ATTR)) firstMeasured.push(target)
  }
  if (firstMeasured.length === 0) return
  // Reading layout flushes the new heights while margins can't transition yet.
  firstMeasured[0].offsetHeight
  for (const target of firstMeasured) target.setAttribute(MEASURED_ATTR, '')
}

let observer: ResizeObserver | undefined

// One observer shared by every entry on the page (absent outside a browser).
function entryHeightObserver() {
  if (typeof ResizeObserver === 'undefined') return undefined
  observer ??= new ResizeObserver((entries) => {
    const records: EntryHeightRecord[] = []
    for (const { target, borderBoxSize } of entries) {
      if (target instanceof HTMLElement) records.push({ target, borderBoxSize })
    }
    applyEntryHeights(records)
  })
  return observer
}

interface LyricsEntryProps extends ComponentPropsWithoutRef<'div'> {
  focused: boolean
}

/**
 * One lyric line plus its transliteration, spaced and focus-scaled as a unit
 * (`.lyrics-entry` in index.css), so the scale can never eat the gap between a
 * line and its own transliteration, and its neighbours are pushed aside rather
 * than overlapped.
 */
export const LyricsEntry = forwardRef<HTMLDivElement, LyricsEntryProps>(
  function LyricsEntry({ focused, className, ...props }, forwardedRef) {
    const elementRef = useRef<HTMLDivElement | null>(null)

    useLayoutEffect(() => {
      const element = elementRef.current
      const heightObserver = entryHeightObserver()
      if (!element || !heightObserver) return
      heightObserver.observe(element)
      return () => heightObserver.unobserve(element)
    }, [])

    const setRefs = useCallback(
      (element: HTMLDivElement | null) => {
        elementRef.current = element
        if (typeof forwardedRef === 'function') forwardedRef(element)
        else if (forwardedRef) forwardedRef.current = element
      },
      [forwardedRef],
    )

    return (
      <div
        ref={setRefs}
        className={clsx('lyrics-entry', focused && 'is-focused', className)}
        {...props}
      />
    )
  },
)
