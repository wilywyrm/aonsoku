import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { CommandGroup, CommandItem } from '@/app/components/ui/command'
import { useSongList } from '@/app/hooks/use-song-list'
import { ROUTES } from '@/routes/routesList'
import { useIsArtistPlaying, usePlayerActions } from '@/store/player.store'
import { ISimilarArtist } from '@/types/responses/artist'
import { CustomGroup, CustomGroupHeader } from './command-group'
import { CommandItemProps } from './command-menu'
import { ResultItem } from './result-item'

type ArtistResultProps = CommandItemProps & {
  artists: ISimilarArtist[]
}

export function CommandArtistResult({
  artists,
  runCommand,
}: ArtistResultProps) {
  const { t } = useTranslation()

  return (
    <CustomGroup>
      <CustomGroupHeader>
        <span>{t('sidebar.artists')}</span>
      </CustomGroupHeader>
      <CommandGroup>
        {artists.length > 0 &&
          artists.map((artist) => (
            <ArtistResultItem
              key={`artist-${artist.id}`}
              artist={artist}
              runCommand={runCommand}
            />
          ))}
      </CommandGroup>
    </CustomGroup>
  )
}

type ArtistResultItemProps = CommandItemProps & {
  artist: ISimilarArtist
}

function ArtistResultItem({ artist, runCommand }: ArtistResultItemProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getArtistAllSongs } = useSongList()
  const { setSongList, togglePlayPause } = usePlayerActions()
  const { isArtistActive, isArtistPlaying } = useIsArtistPlaying(artist.id)

  async function handlePlayArtistRadio() {
    if (isArtistActive) {
      togglePlayPause()
      return
    }

    const artistSongs = await getArtistAllSongs(artist.name)
    if (!artistSongs) return

    setSongList(artistSongs, 0, false, {
      id: artist.id,
      name: artist.name,
      type: 'artist',
    })
  }

  return (
    <CommandItem
      value={`artist-${artist.id}`}
      className="border mb-1"
      onSelect={() => {
        runCommand(() => navigate(ROUTES.ARTIST.PAGE(artist.id)))
      }}
    >
      <ResultItem
        coverArt={artist.coverArt}
        coverArtType="artist"
        title={artist.name}
        artist={t('artist.info.albumsCount', {
          count: artist.albumCount,
        })}
        onClick={handlePlayArtistRadio}
        isPlaying={isArtistPlaying}
      />
    </CommandItem>
  )
}
