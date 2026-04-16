import randomCSSHexColor from '@chriscodesthings/random-css-hex-color'
import { useState } from 'react'
import { getAverageColor } from '@/utils/getAverageColor'

export function useAlbumColor(imageId: string) {
  const [bgColor, setBgColor] = useState('')

  function getImage() {
    return document.getElementById(imageId) as HTMLImageElement
  }

  async function handleLoadImage() {
    const img = getImage()
    if (!img) return

    let color = randomCSSHexColor(true)

    try {
      color = (await getAverageColor(img)).hex
    } catch (_) {
      console.warn(
        'handleLoadImage: unable to get image color. Using a random color.',
      )
    }

    setBgColor(color)
  }

  function handleError() {
    const img = getImage()
    if (!img) return

    img.crossOrigin = null
  }

  return { bgColor, handleLoadImage, handleError }
}
