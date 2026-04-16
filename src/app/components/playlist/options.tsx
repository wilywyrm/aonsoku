import { OptionsButtons } from '@/app/components/options/buttons'
import { DownloadOptionHandler } from '@/app/components/options/download-handler'
import { DropdownMenuSeparator } from '@/app/components/ui/dropdown-menu'
import { useOptions } from '@/app/hooks/use-options'
import { subsonic } from '@/service/subsonic'
import { useIsPlaylistPlaying, usePlayerActions } from '@/store/player.store'
import { usePlaylists, useRemovePlaylist } from '@/store/playlists.store'
import { PlaybackSource } from '@/types/playerContext'
import { Playlist, PlaylistWithEntries } from '@/types/responses/playlist'
import { ISong } from '@/types/responses/song'

type GetSongsToQueueCallback = (songs: ISong[], source?: PlaybackSource) => void

interface PlaylistOptionsProps {
  playlist: PlaylistWithEntries | Playlist
  variant?: 'context' | 'dropdown'
  showPlay?: boolean
  disablePlayNext?: boolean
  disableAddLast?: boolean
  disableDownload?: boolean
  disableEdit?: boolean
  disableDelete?: boolean
}

export function PlaylistOptions({
  playlist,
  variant = 'dropdown',
  showPlay = false,
  disablePlayNext = false,
  disableAddLast = false,
  disableDownload = false,
  disableEdit = false,
  disableDelete = false,
}: PlaylistOptionsProps) {
  const { setPlaylistDialogState, setData } = usePlaylists()
  const { play, playNext, playLast, startDownload } = useOptions()
  const { setPlaylistId, setConfirmDialogState } = useRemovePlaylist()
  const { isPlaylistActive, isPlaylistPlaying } = useIsPlaylistPlaying(
    playlist.id,
  )
  const { togglePlayPause } = usePlayerActions()

  function handleEdit() {
    setData({
      id: playlist.id,
      name: playlist.name,
      comment: playlist.comment,
      public: playlist.public,
    })
    setPlaylistDialogState(true)
  }

  async function getSongsToQueue(
    callback: GetSongsToQueueCallback,
    source?: PlaybackSource,
  ) {
    const playlistWithEntries = await subsonic.playlists.getOne(playlist.id)
    if (!playlistWithEntries) return

    callback(playlistWithEntries.entry, source)
  }

  const playbackSource: PlaybackSource = {
    id: playlist.id,
    name: playlist.name,
    type: 'playlist',
  }

  async function handlePlay() {
    if (isPlaylistActive) {
      if (!isPlaylistPlaying) togglePlayPause()
      return
    }

    if ('entry' in playlist) {
      play(playlist.entry, playbackSource)
    } else {
      await getSongsToQueue(play, playbackSource)
    }
  }

  async function handlePlayNext() {
    if ('entry' in playlist) {
      playNext(playlist.entry)
    } else {
      await getSongsToQueue(playNext)
    }
  }

  async function handlePlayLast() {
    if ('entry' in playlist) {
      playLast(playlist.entry)
    } else {
      await getSongsToQueue(playLast)
    }
  }

  function handleDownload() {
    startDownload(playlist.id)
  }

  return (
    <>
      {variant === 'context' && (
        <>
          <div className="px-2 py-0.5 max-w-64">
            <span className="text-xs text-muted-foreground break-words line-clamp-4">
              {playlist.name}
            </span>
          </div>
          <DropdownMenuSeparator />
        </>
      )}
      {showPlay && (
        <OptionsButtons.Play
          variant={variant}
          onClick={(e) => {
            e.stopPropagation()
            handlePlay()
          }}
        />
      )}
      <OptionsButtons.PlayNext
        variant={variant}
        disabled={disablePlayNext}
        onClick={(e) => {
          e.stopPropagation()
          handlePlayNext()
        }}
      />
      <OptionsButtons.PlayLast
        variant={variant}
        disabled={disableAddLast}
        onClick={(e) => {
          e.stopPropagation()
          handlePlayLast()
        }}
      />
      <DownloadOptionHandler group={false}>
        <OptionsButtons.Download
          variant={variant}
          disabled={disableDownload}
          onClick={(e) => {
            e.stopPropagation()
            handleDownload()
          }}
        />
      </DownloadOptionHandler>
      <DropdownMenuSeparator />
      <OptionsButtons.EditPlaylist
        variant={variant}
        onClick={(e) => {
          e.stopPropagation()
          handleEdit()
        }}
        disabled={disableEdit}
      />
      <OptionsButtons.RemovePlaylist
        variant={variant}
        onClick={(e) => {
          e.stopPropagation()
          setPlaylistId(playlist.id)
          setConfirmDialogState(true)
        }}
        disabled={disableDelete}
      />
    </>
  )
}
