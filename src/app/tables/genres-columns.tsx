import { memo } from 'react'
import { Link } from 'react-router-dom'
import { DataTableColumnHeader } from '@/app/components/ui/data-table-column-header'
import i18n from '@/i18n'
import { ROUTES } from '@/routes/routesList'
import { ColumnDefType } from '@/types/react-table/columnDef'
import { Genre } from '@/types/responses/genre'

const MemoDataTableColumnHeader = memo(
  DataTableColumnHeader,
) as typeof DataTableColumnHeader

export function genresColumns(): ColumnDefType<Genre>[] {
  return [
    {
      id: 'value',
      accessorKey: 'value',
      enableSorting: true,
      sortingFn: 'customSortFn',
      style: {
        flex: 1,
        minWidth: 100,
      },
      header: ({ column, table }) => (
        <MemoDataTableColumnHeader
          column={column}
          table={table}
          className="px-2"
        >
          {i18n.t('table.columns.name')}
        </MemoDataTableColumnHeader>
      ),
      cell: ({ row }) => (
        <Link
          to={ROUTES.GENRE.PAGE(row.original.value)}
          className="hover:underline font-medium p-2"
          onClick={(e) => e.stopPropagation()}
        >
          {row.original.value}
        </Link>
      ),
    },
    {
      id: 'albumCount',
      accessorKey: 'albumCount',
      enableSorting: true,
      sortingFn: 'basic',
      style: {
        width: '20%',
        maxWidth: '20%',
      },
      header: ({ column, table }) => (
        <MemoDataTableColumnHeader column={column} table={table}>
          {i18n.t('table.columns.albumCount')}
        </MemoDataTableColumnHeader>
      ),
    },
    {
      id: 'songCount',
      accessorKey: 'songCount',
      enableSorting: true,
      sortingFn: 'basic',
      style: {
        width: '20%',
        maxWidth: '20%',
      },
      header: ({ column, table }) => (
        <MemoDataTableColumnHeader column={column} table={table}>
          {i18n.t('table.columns.songCount')}
        </MemoDataTableColumnHeader>
      ),
    },
  ]
}
