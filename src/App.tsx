import { useEffect, useState } from 'react'
import { isDesktop } from 'react-device-detect'
import { RouterProvider } from 'react-router-dom'
import { SettingsDialog } from '@/app/components/settings/dialog'
import { LangObserver } from '@/app/observers/lang-observer'
import { MediaSessionObserver } from '@/app/observers/media-session-observer'
import { MigrationObserver } from '@/app/observers/migration-observer'
import { ThemeObserver } from '@/app/observers/theme-observer'
import { ToastContainer } from '@/app/observers/toast-container'
import { UpdateObserver } from '@/app/observers/update-observer'
import { Mobile } from '@/app/pages/mobile'
import { router } from '@/routes/router'
import { waitForHydration } from '@/store/hydration'
import { isTauri } from '@/utils/tauriTools'

function App() {
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    waitForHydration().then(() => {
      setIsHydrated(true)
    })
  }, [])

  if (!isDesktop && window.innerHeight > window.innerWidth) return <Mobile /> // Support tablets but not phones

  // Wait for store hydration before rendering
  if (!isHydrated) {
    return null // Or a loading spinner if you prefer
  }

  return (
    <>
      <MigrationObserver />
      {isTauri() && <UpdateObserver />}
      <MediaSessionObserver />
      <LangObserver />
      <ThemeObserver />
      <SettingsDialog />
      <RouterProvider router={router} />
      <ToastContainer />
    </>
  )
}

export default App
