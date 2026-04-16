import {
  STICKY_HEADER_IMAGE_ID,
  StickyHeader,
  StickyHeaderButton,
  StickyHeaderContent,
  StickyHeaderImage,
  StickyHeaderTexts,
} from '@/app/components/sticky-header'
import { useAlbumColor } from '@/app/hooks/use-album-color'
import { useSongList } from '@/app/hooks/use-song-list'
import { useIsArtistPlaying, usePlayerActions } from '@/store/player.store'
import { IArtist } from '@/types/responses/artist'

interface ArtistStickyHeaderProps {
  artist: IArtist
}

export function ArtistStickyHeader({ artist }: ArtistStickyHeaderProps) {
  const { bgColor, handleLoadImage, handleError } = useAlbumColor(
    STICKY_HEADER_IMAGE_ID,
  )
  const { getArtistAllSongs } = useSongList()

  const { isArtistActive, isArtistPlaying } = useIsArtistPlaying(artist.id)
  const { setSongList, togglePlayPause } = usePlayerActions()

  async function playArtistRadio() {
    const songList = await getArtistAllSongs(artist.name)

    if (songList) {
      setSongList(songList, 0, false, {
        id: artist.id,
        name: artist.name,
        type: 'artist',
      })
    }
  }

  function handlePlayButton() {
    if (isArtistActive) {
      togglePlayPause()
    } else {
      playArtistRadio()
    }
  }

  return (
    <StickyHeader key={artist.id} style={{ backgroundColor: bgColor }}>
      <StickyHeaderButton
        isPlaying={isArtistPlaying}
        onClick={handlePlayButton}
      />

      <StickyHeaderContent>
        <StickyHeaderImage
          id={artist.coverArt}
          type="artist"
          size="700"
          alt={artist.name}
          onLoad={handleLoadImage}
          onError={handleError}
        />

        <StickyHeaderTexts title={artist.name} />
      </StickyHeaderContent>
    </StickyHeader>
  )
}
