import { Disc3, Shuffle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/ui/button'
import { subsonic } from '@/service/subsonic'
import { usePlayerActions } from '@/store/player.store'

interface GenreButtonsProps {
  genre: string
}

export function GenreButtons({ genre }: GenreButtonsProps) {
  const { t } = useTranslation()
  const { setSongList } = usePlayerActions()

  async function handleShuffleTracks() {
    const songs = await subsonic.genres.getSongsByGenre({ genre })

    if (songs && songs.length > 0) {
      setSongList(songs, 0, true)
    }
  }

  async function handleShuffleAlbums() {
    const songs = await subsonic.songs.getRandomSongs({ genre, size: 500 })

    if (songs && songs.length > 0) {
      setSongList(songs, 0, false)
    }
  }

  return (
    <div className="w-full flex items-center gap-2">
      <Button
        variant="default"
        className="rounded-full gap-2 px-5"
        onClick={handleShuffleTracks}
      >
        <Shuffle className="w-4 h-4" />
        {t('genres.buttons.shuffleTracks')}
      </Button>

      <Button
        variant="ghost"
        className="rounded-full gap-2 px-5 hover:bg-foreground/10"
        onClick={handleShuffleAlbums}
      >
        <Disc3 className="w-4 h-4" />
        {t('genres.buttons.shuffleAlbums')}
      </Button>
    </div>
  )
}
