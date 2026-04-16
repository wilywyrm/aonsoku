import { ImageHeaderEffect } from '@/app/components/album/header-effect'
import { AlbumHeaderFallback } from '@/app/components/fallbacks/album-fallbacks'
import { SongListFallback } from '@/app/components/fallbacks/song-fallbacks'
import ListWrapper from '@/app/components/list-wrapper'
import { MainGrid } from '@/app/components/main-grid'
import { Skeleton } from '@/app/components/ui/skeleton'

export function GenresFallback() {
  return <SongListFallback />
}

export function GenreFallback() {
  return (
    <div className="w-full">
      <div className="relative">
        <AlbumHeaderFallback />
        <ImageHeaderEffect className="bg-muted-foreground" />
      </div>
      <ListWrapper>
        <div className="flex items-center gap-2">
          <Skeleton className="rounded-full h-9 w-36" />
          <Skeleton className="rounded-full h-9 w-36" />
        </div>
      </ListWrapper>
      <ListWrapper className="px-8 pt-0">
        <MainGrid>
          {Array.from({ length: 24 }).map((_, index) => (
            <div key={'genre-card-fallback-' + index}>
              <Skeleton className="aspect-square" />
              <Skeleton className="h-[13px] w-11/12 mt-2" />
              <Skeleton className="h-3 w-1/2 mt-[7px]" />
            </div>
          ))}
        </MainGrid>
      </ListWrapper>
    </div>
  )
}
