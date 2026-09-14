import { LazyLoadImage } from 'react-lazy-load-image-component'
import { Link } from 'react-router-dom'
import { AnimatedCoverVideo } from '@/app/components/album/animated-cover-video'
import { ImageLoader } from '@/app/components/image-loader'
import { LinkWithoutTo } from '@/app/components/song/artist-link'
import { AspectRatio } from '@/app/components/ui/aspect-ratio'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/routes/routesList'
import { useMainDrawerState, usePlayerSonglist } from '@/store/player.store'
import { ISong } from '@/types/responses/song'
import { ALBUM_ARTISTS_MAX_NUMBER } from '@/utils/multipleArtists'

export function CurrentSongInfo() {
  const { currentSong } = usePlayerSonglist()
  const { closeDrawer } = useMainDrawerState()

  return (
    <div className="mr-12 hidden lg:flex lg:flex-col lg:justify-center h-full w-[260px] lg:w-[320px] 2xl:w-[380px]">
      {/* Only the square album-art wrapper is in normal flow, so
          lg:justify-center positions it by its own height. The title/artist
          are absolutely positioned below the art and never shift its centre. */}
      <div className="relative w-full">
        <AspectRatio
          ratio={1 / 1}
          className="shadow-header-image rounded-md overflow-hidden bg-accent"
        >
          <div className="relative w-full h-full">
            <ImageLoader id={currentSong.coverArt} type="song" size={900}>
              {(src) => (
                <LazyLoadImage
                  id="song-info-image"
                  src={src}
                  effect="opacity"
                  alt={`${currentSong.artist} - ${currentSong.title}`}
                  className="rounded-md aspect-square object-cover text-transparent"
                  width="100%"
                  height="100%"
                />
              )}
            </ImageLoader>

            <AnimatedCoverVideo
              artist={currentSong.artist}
              album={currentSong.album}
              screen="drawer"
              className="rounded-md"
            />
          </div>
        </AspectRatio>

        <div className="absolute top-full inset-x-0 flex flex-col items-center justify-center mt-6 px-1">
          <h4 className="scroll-m-20 text-xl font-semibold tracking-tight text-center text-balance text-shadow-lg">
            {currentSong.albumId ? (
              <Link
                to={ROUTES.ALBUM.PAGE(currentSong.albumId)}
                className="hover:underline"
                onClick={closeDrawer}
              >
                {currentSong.title}
              </Link>
            ) : (
              <>{currentSong.title}</>
            )}
          </h4>

          <div className="leading-5 mt-1 text-foreground/70 text-shadow-lg flex items-center justify-center flex-wrap gap-1">
            <QueueArtistsLinks song={currentSong} />
          </div>
        </div>
      </div>
    </div>
  )
}

function QueueArtistsLinks({ song }: { song: ISong }) {
  const { closeDrawer } = useMainDrawerState()
  const { artist, artistId, artists } = song

  if (artists && artists.length > 1) {
    const data = artists.slice(0, ALBUM_ARTISTS_MAX_NUMBER)

    return (
      <>
        {data.map(({ id, name }, index) => (
          <div key={id}>
            <ArtistLink id={id} name={name} onClick={closeDrawer} />
            {index < data.length - 1 && ','}
          </div>
        ))}
      </>
    )
  }

  return <ArtistLink id={artistId} name={artist} onClick={closeDrawer} />
}

type ArtistLinkProps = LinkWithoutTo & {
  id?: string
  name: string
}

function ArtistLink({ id, name, className, ...props }: ArtistLinkProps) {
  return (
    <Link
      className={cn(
        className,
        id ? 'hover:underline hover:text-foreground' : 'pointer-events-none',
      )}
      to={ROUTES.ARTIST.PAGE(id ?? '')}
      {...props}
    >
      {name}
    </Link>
  )
}
