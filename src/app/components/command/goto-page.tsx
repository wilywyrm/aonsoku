import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { CommandGroup, CommandItem } from '@/app/components/ui/command'
import { libraryItems, mainNavItems, SidebarItems } from '@/app/layout/sidebar'
import { useAppStore } from '@/store/app.store'
import { GridViewWrapperType, resetGridClickedItem } from '@/utils/gridTools'
import { CommandItemProps } from './command-menu'

export function CommandGotoPage({ runCommand }: CommandItemProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const hideArtistsSection = useAppStore().pages.hideArtistsSection
  const hideSongsSection = useAppStore().pages.hideSongsSection
  const hideAlbumsSection = useAppStore().pages.hideAlbumsSection
  const hideGenresSection = useAppStore().pages.hideGenresSection
  const hideFavoritesSection = useAppStore().pages.hideFavoritesSection
  const hidePlaylistsSection = useAppStore().pages.hidePlaylistsSection
  const hideRadiosSection = useAppStore().pages.hideRadiosSection
  const isPodcastsActive = useAppStore().podcasts.active

  const pages = [...mainNavItems, ...libraryItems]

  return (
    <CommandGroup heading={t('command.pages')}>
      {pages.map(({ id, route, title }) => {
        if (hideArtistsSection && id === SidebarItems.Artists) return null
        if (hideSongsSection && id === SidebarItems.Songs) return null
        if (hideAlbumsSection && id === SidebarItems.Albums) return null
        if (hideGenresSection && id === SidebarItems.Genres) return null
        if (hideFavoritesSection && id === SidebarItems.Favorites) return null
        if (hidePlaylistsSection && id === SidebarItems.Playlists) return null
        if (hideRadiosSection && id === SidebarItems.Radios) return null
        if (!isPodcastsActive && id === SidebarItems.Podcasts) return null

        return (
          <CommandItem
            key={route}
            onSelect={() => {
              resetGridClickedItem({ name: id as GridViewWrapperType })
              runCommand(() => navigate(route))
            }}
          >
            {t(title)}
          </CommandItem>
        )
      })}
    </CommandGroup>
  )
}
