import { httpClient } from '@/api/httpClient'
import { GenresResponse } from '@/types/responses/genre'
import { SongsByGenreResponse } from '@/types/responses/song'

async function get() {
  const response = await httpClient<GenresResponse>('/getGenres', {
    method: 'GET',
  })

  return response?.data.genres.genre
}

interface GetSongsByGenreParams {
  genre: string
  count?: number
  offset?: number
}

async function getSongsByGenre({
  genre,
  count = 500,
  offset = 0,
}: GetSongsByGenreParams) {
  const response = await httpClient<SongsByGenreResponse>('/getSongsByGenre', {
    method: 'GET',
    query: {
      genre,
      count: count.toString(),
      offset: offset.toString(),
    },
  })

  return response?.data.songsByGenre.song
}

export const genres = {
  get,
  getSongsByGenre,
}
