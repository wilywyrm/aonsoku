import { useEffect, useState } from 'react'
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from '@/app/components/ui/carousel'
import { CarouselButton } from '@/app/components/ui/carousel-button'
import { ISimilarArtist } from '@/types/responses/artist'
import { RelatedArtistCard } from './related-artist-card'

interface RelatedArtistsListProps {
  title: string
  similarArtists: ISimilarArtist[]
}

export default function RelatedArtistsList({
  title,
  similarArtists,
}: RelatedArtistsListProps) {
  const [api, setApi] = useState<CarouselApi>()
  const [canScrollPrev, setCanScrollPrev] = useState<boolean>()
  const [canScrollNext, setCanScrollNext] = useState<boolean>()

  if (similarArtists.length > 16) {
    similarArtists = similarArtists.slice(0, 16)
  }

  useEffect(() => {
    if (!api) {
      return
    }

    setCanScrollPrev(api.canScrollPrev())
    setCanScrollNext(api.canScrollNext())

    api.on('select', () => {
      setCanScrollPrev(api.canScrollPrev())
      setCanScrollNext(api.canScrollNext())
    })
  }, [api])

  return (
    <div className="w-full flex flex-col mb-4">
      <div className="my-4 flex justify-between items-center">
        <h3 className="scroll-m-20 text-2xl font-semibold tracking-tight">
          {title}
        </h3>
        <div className="flex gap-2">
          <CarouselButton
            direction="prev"
            disabled={!canScrollPrev}
            onClick={() => api?.scrollPrev()}
          />
          <CarouselButton
            direction="next"
            disabled={!canScrollNext}
            onClick={() => api?.scrollNext()}
          />
        </div>
      </div>

      <div className="transform-gpu">
        <Carousel
          opts={{
            align: 'start',
            slidesToScroll: 'auto',
          }}
          setApi={setApi}
        >
          <CarouselContent>
            {similarArtists.map((artist) => (
              <CarouselItem key={artist.id} className="basis-1/6 2xl:basis-1/8">
                <RelatedArtistCard artist={artist} />
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      </div>
    </div>
  )
}
