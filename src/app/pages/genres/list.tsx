import { useQuery } from '@tanstack/react-query'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ShadowHeader } from '@/app/components/album/shadow-header'
import { SongListFallback } from '@/app/components/fallbacks/song-fallbacks'
import { HeaderTitle } from '@/app/components/header-title'
import ListWrapper from '@/app/components/list-wrapper'
import { DataTable } from '@/app/components/ui/data-table'
import { genresColumns } from '@/app/tables/genres-columns'
import { ROUTES } from '@/routes/routesList'
import { subsonic } from '@/service/subsonic'
import { queryKeys } from '@/utils/queryKeys'

const MemoShadowHeader = memo(ShadowHeader)
const MemoHeaderTitle = memo(HeaderTitle)
const MemoDataTable = memo(DataTable) as typeof DataTable

export default function GenresList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const columns = genresColumns()

  const { data: genres, isLoading } = useQuery({
    queryKey: [queryKeys.genre.all],
    queryFn: subsonic.genres.get,
  })

  if (isLoading) return <SongListFallback />
  if (!genres) return null

  const filteredGenres = genres
    .filter((genre) => genre.albumCount >= 2)
    .sort((a, b) => b.songCount - a.songCount)

  return (
    <div className="w-full h-full">
      <MemoShadowHeader>
        <MemoHeaderTitle
          title={t('sidebar.genres')}
          count={filteredGenres.length}
        />
      </MemoShadowHeader>

      <ListWrapper>
        <MemoDataTable
          columns={columns}
          data={filteredGenres}
          showPagination={true}
          showSearch={true}
          searchColumn="value"
          allowRowSelection={false}
          dataType="genre"
          onRowClick={(row) => navigate(ROUTES.GENRE.PAGE(row.original.value))}
        />
      </ListWrapper>
    </div>
  )
}
