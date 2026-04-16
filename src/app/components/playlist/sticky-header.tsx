import {
  STICKY_HEADER_IMAGE_ID,
  StickyHeader,
  StickyHeaderButton,
  StickyHeaderContent,
  StickyHeaderImage,
  StickyHeaderTexts,
} from '@/app/components/sticky-header'
import { useAlbumColor } from '@/app/hooks/use-album-color'
import { useIsPlaylistPlaying, usePlayerActions } from '@/store/player.store'
import { PlaybackSource } from '@/types/playerContext'
import { PlaylistWithEntries } from '@/types/responses/playlist'

interface PlaylistStickyHeaderProps {
  playlist: PlaylistWithEntries
}

export function PlaylistStickyHeader({ playlist }: PlaylistStickyHeaderProps) {
  const { bgColor, handleLoadImage, handleError } = useAlbumColor(
    STICKY_HEADER_IMAGE_ID,
  )

  const { isPlaylistActive, isPlaylistPlaying } = useIsPlaylistPlaying(
    playlist.id,
  )
  const { setSongList, togglePlayPause } = usePlayerActions()

  function handlePlayButton() {
    if (isPlaylistActive) {
      togglePlayPause()
    } else {
      const playbackSource: PlaybackSource = {
        id: playlist.id,
        name: playlist.name,
        type: 'playlist',
      }
      setSongList(playlist.entry, 0, false, playbackSource)
    }
  }

  return (
    <StickyHeader key={playlist.id} style={{ backgroundColor: bgColor }}>
      <StickyHeaderButton
        isPlaying={isPlaylistPlaying}
        onClick={handlePlayButton}
      />

      <StickyHeaderContent>
        <StickyHeaderImage
          id={playlist.coverArt}
          type="album"
          size="700"
          alt={playlist.name}
          onLoad={handleLoadImage}
          onError={handleError}
        />

        <StickyHeaderTexts title={playlist.name} subtitle={playlist.comment} />
      </StickyHeaderContent>
    </StickyHeader>
  )
}
