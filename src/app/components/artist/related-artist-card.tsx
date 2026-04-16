import clsx from 'clsx'
import { EqualizerBars } from '@/app/components/icons/equalizer-bars'
import { ImageLoader } from '@/app/components/image-loader'
import { PreviewCard } from '@/app/components/preview-card/card'
import { useSongList } from '@/app/hooks/use-song-list'
import { ROUTES } from '@/routes/routesList'
import { useIsArtistPlaying, usePlayerActions } from '@/store/player.store'
import { ISimilarArtist } from '@/types/responses/artist'

interface RelatedArtistCardProps {
  artist: ISimilarArtist
}

export function RelatedArtistCard({ artist }: RelatedArtistCardProps) {
  const { getArtistAllSongs } = useSongList()
  const { setSongList, togglePlayPause } = usePlayerActions()
  const { isArtistActive, isArtistPlaying } = useIsArtistPlaying(artist.id)

  async function playArtistRadio(artist: ISimilarArtist) {
    const songList = await getArtistAllSongs(artist.name)

    if (!songList) return

    setSongList(songList, 0, false, {
      id: artist.id,
      name: artist.name,
      type: 'artist',
    })
  }

  function handlePlayButton() {
    if (isArtistActive) {
      togglePlayPause()
    } else {
      playArtistRadio(artist)
    }
  }

  return (
    <PreviewCard.Root>
      <PreviewCard.ImageWrapper link={ROUTES.ARTIST.PAGE(artist.id)}>
        <ImageLoader id={artist.coverArt} type="artist">
          {(src) => <PreviewCard.Image src={src} alt={artist.name} />}
        </ImageLoader>
        {isArtistPlaying ? (
          <PreviewCard.PauseButton onClick={togglePlayPause} />
        ) : (
          <PreviewCard.PlayButton onClick={handlePlayButton} />
        )}
      </PreviewCard.ImageWrapper>
      <PreviewCard.InfoWrapper>
        <div className="flex items-center gap-1">
          {isArtistPlaying && (
            <EqualizerBars size={14} className="text-primary" />
          )}
          <PreviewCard.Subtitle
            link={ROUTES.ARTIST.PAGE(artist.id)}
            className={clsx('mt-2', isArtistPlaying && 'text-primary')}
          >
            {artist.name}
          </PreviewCard.Subtitle>
        </div>
      </PreviewCard.InfoWrapper>
    </PreviewCard.Root>
  )
}
