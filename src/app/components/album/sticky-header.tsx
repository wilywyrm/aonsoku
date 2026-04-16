import {
  STICKY_HEADER_IMAGE_ID,
  StickyHeader,
  StickyHeaderButton,
  StickyHeaderContent,
  StickyHeaderImage,
  StickyHeaderTexts,
} from '@/app/components/sticky-header'
import { useAlbumColor } from '@/app/hooks/use-album-color'
import { useIsAlbumPlaying, usePlayerActions } from '@/store/player.store'
import { PlaybackSource } from '@/types/playerContext'
import { SingleAlbum } from '@/types/responses/album'

interface AlbumStickyHeaderProps {
  album: SingleAlbum
}

export function AlbumStickyHeader({ album }: AlbumStickyHeaderProps) {
  const { bgColor, handleLoadImage, handleError } = useAlbumColor(
    STICKY_HEADER_IMAGE_ID,
  )

  const { isAlbumActive, isAlbumPlaying } = useIsAlbumPlaying(album.id)
  const { setSongList, togglePlayPause } = usePlayerActions()

  function handlePlayButton() {
    if (isAlbumActive) {
      togglePlayPause()
    } else {
      const playbackSource: PlaybackSource = {
        id: album.id,
        name: album.name,
        type: 'album',
      }
      setSongList(album.song, 0, false, playbackSource)
    }
  }

  return (
    <StickyHeader key={album.id} style={{ backgroundColor: bgColor }}>
      <StickyHeaderButton
        isPlaying={isAlbumPlaying}
        onClick={handlePlayButton}
      />

      <StickyHeaderContent>
        <StickyHeaderImage
          id={album.coverArt}
          type="album"
          size="700"
          alt={album.name}
          onLoad={handleLoadImage}
          onError={handleError}
        />

        <StickyHeaderTexts title={album.name} subtitle={album.artist} />
      </StickyHeaderContent>
    </StickyHeader>
  )
}
