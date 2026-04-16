const selector = '#main-scroll-area #scroll-viewport'

export function getMainScrollElement() {
  return document.querySelector(selector) as HTMLDivElement
}

export function getMainScrollContentElement() {
  return document.querySelector(`${selector} > div`) as HTMLDivElement
}

export function getImageHeaderContainer() {
  return document.getElementById('image-header-container') as HTMLDivElement
}

export function scrollPageToTop() {
  const el = document.querySelector(selector)

  if (el) {
    el.scrollTo({ top: 0 })
  }
}
