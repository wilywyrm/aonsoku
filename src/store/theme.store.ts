import merge from 'lodash/merge'
import {
  createJSONStorage,
  devtools,
  persist,
  subscribeWithSelector,
} from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { createWithEqualityFn } from 'zustand/traditional'
import { IThemeContext, Theme } from '@/types/themeContext'
import { indexedDBStorage } from '@/utils/storage'

export const useThemeStore = createWithEqualityFn<IThemeContext>()(
  subscribeWithSelector(
    persist(
      devtools(
        immer((set) => ({
          theme: Theme.Dark,
          setTheme: (theme: Theme) => {
            set((state) => {
              state.theme = theme
            })
          },
        })),
        {
          name: 'theme_store',
        },
      ),
      {
        name: 'theme_store',
        version: 1,
        storage: createJSONStorage(() => indexedDBStorage),
        merge: (persistedState, currentState) => {
          return merge(currentState, persistedState)
        },
      },
    ),
  ),
)

export const useTheme = () => useThemeStore((state) => state)
