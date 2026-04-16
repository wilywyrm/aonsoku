import { RefObject, useEffect, useRef, useState } from 'react'

export function useDetectSticky(
  ref?: RefObject<HTMLDivElement>,
  observerSettings: IntersectionObserverInit = {
    threshold: [1],
    rootMargin: '-1px 0px 0px 0px',
  },
) {
  const [isSticky, setIsSticky] = useState(false)
  const newRef = useRef<HTMLDivElement>(null)
  ref ||= newRef

  // mount
  useEffect(() => {
    if (!ref) return

    const cachedRef = ref.current

    if (!cachedRef) return

    const observer = new IntersectionObserver(
      ([e]) => setIsSticky(e.intersectionRatio < 1),
      observerSettings,
    )

    observer.observe(cachedRef)

    // unmount
    return () => {
      observer.unobserve(cachedRef)
    }
  }, [observerSettings, ref])

  return {
    isSticky,
    ref,
    setIsSticky,
  }
}
