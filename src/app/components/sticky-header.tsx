import clsx from 'clsx'
import { ComponentPropsWithoutRef, useEffect, useState } from 'react'
import { LazyLoadImage } from 'react-lazy-load-image-component'
import { cn } from '@/lib/utils'
import { CoverArt } from '@/types/coverArtType'
import {
  getImageHeaderContainer,
  getMainScrollContentElement,
  getMainScrollElement,
} from '@/utils/scrollPageToTop'
import { Actions } from './actions'
import { ImageLoader } from './image-loader'

type StickyHeaderProps = ComponentPropsWithoutRef<'div'> & {
  contentClassName?: string
}

export const STICKY_HEADER_IMAGE_ID = 'sticky-cover-art-image'

export function StickyHeader({
  children,
  className,
  style,
  contentClassName,
  ...props
}: StickyHeaderProps) {
  const [opacity, setOpacity] = useState(0)
  const [contentOpacity, setContentOpacity] = useState(0)

  useEffect(() => {
    const scrollContainer = getMainScrollElement()
    const contentContainer = getMainScrollContentElement()
    const imageHeaderContainer = getImageHeaderContainer()

    if (!scrollContainer || !contentContainer || !imageHeaderContainer) return

    const handleScroll = () => {
      const imageHeaderHeight = imageHeaderContainer.offsetHeight
      const contentHeight = contentContainer.offsetHeight
      const scrollContainerHeight = scrollContainer.offsetHeight
      const pageScrollableSize = contentHeight - imageHeaderHeight

      if (pageScrollableSize <= scrollContainerHeight) {
        setOpacity(0)
        setContentOpacity(0)
        return
      }

      const scrollTop = scrollContainer.scrollTop

      const startFade = 30
      const endFade = 300

      if (scrollTop <= startFade) {
        setOpacity(0)
        setContentOpacity(0)
        return
      }

      if (scrollTop >= endFade) {
        setOpacity(1)
        setContentOpacity(1)
        return
      }

      const calculatedOpacity = (scrollTop - startFade) / (endFade - startFade)
      setOpacity(calculatedOpacity)
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })

    const resizeObserver = new ResizeObserver(handleScroll)
    resizeObserver.observe(scrollContainer)

    handleScroll()

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
    }
  }, [])

  const isHidden = opacity === 0

  return (
    <div className="sticky top-0 z-10 h-0 w-full">
      <div
        className={cn(
          'absolute top-0 left-0 w-full h-shadow-header',
          'transition-opacity shadow-sm',
          isHidden && 'pointer-events-none',
          className,
        )}
        style={{ ...style, opacity }}
        {...props}
      >
        <div className="w-full h-shadow-header bg-background/50">
          <div
            className={cn(
              'flex items-center gap-4 w-full h-shadow-header px-8 transition-opacity duration-500 delay-150',
              contentClassName,
            )}
            style={{ opacity: contentOpacity }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

type StickyHeaderButtonProps = ComponentPropsWithoutRef<
  typeof Actions.Button
> & {
  isPlaying: boolean
}

export function StickyHeaderButton({
  isPlaying,
  onClick,
}: StickyHeaderButtonProps) {
  return (
    <Actions.Button
      buttonStyle="primary"
      onClick={onClick}
      className="w-10 h-10 min-w-10 min-h-10 shrink-0 p-3 m-0"
    >
      {isPlaying ? <Actions.PauseIcon /> : <Actions.PlayIcon />}
    </Actions.Button>
  )
}

type StickyHeaderContentProps = ComponentPropsWithoutRef<'div'>

export function StickyHeaderContent({
  className,
  children,
  ...props
}: StickyHeaderContentProps) {
  return (
    <div className={cn('flex items-center gap-2', className)} {...props}>
      {children}
    </div>
  )
}

type StickyHeaderImageProps = ComponentPropsWithoutRef<typeof LazyLoadImage> & {
  id: string
  type: CoverArt
  size?: string
}

export function StickyHeaderImage({
  id,
  type,
  size = '80',
  ...props
}: StickyHeaderImageProps) {
  return (
    <ImageLoader id={id} type={type} size={size}>
      {(src) => (
        <div className="w-10 h-10 min-w-10 min-h-10 shrink-0 bg-skeleton rounded overflow-hidden shadow-md">
          {src ? (
            <LazyLoadImage
              {...props}
              src={src}
              effect="opacity"
              crossOrigin="anonymous"
              id={STICKY_HEADER_IMAGE_ID}
              className="w-full h-full object-cover"
            />
          ) : null}
        </div>
      )}
    </ImageLoader>
  )
}

type StickyHeaderTextsProps = {
  title: string
  subtitle?: string
}

export function StickyHeaderTexts({ title, subtitle }: StickyHeaderTextsProps) {
  return (
    <div className="flex flex-col justify-center overflow-hidden">
      <span
        className={clsx(
          'font-semibold truncate',
          subtitle ? 'text-sm' : 'text-2xl mt-0.5',
        )}
      >
        {title}
      </span>
      {subtitle && (
        <span className="text-xs text-foreground opacity-80 truncate">
          {subtitle}
        </span>
      )}
    </div>
  )
}
