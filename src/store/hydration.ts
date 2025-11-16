// Track hydration state across all stores
let hydrationComplete = false
let hydrationPromise: Promise<void> | null = null
const hydrationCallbacks: (() => void)[] = []

export function markHydrationComplete() {
  hydrationComplete = true
  hydrationCallbacks.forEach((callback) => callback())
  hydrationCallbacks.length = 0
}

export function isHydrationComplete(): boolean {
  return hydrationComplete
}

export function waitForHydration(): Promise<void> {
  if (hydrationComplete) {
    return Promise.resolve()
  }

  if (hydrationPromise) {
    return hydrationPromise
  }

  hydrationPromise = new Promise<void>((resolve) => {
    hydrationCallbacks.push(resolve)
  })

  return hydrationPromise
}

