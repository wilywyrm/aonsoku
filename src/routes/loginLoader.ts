import { redirect } from 'react-router-dom'
import { ROUTES } from '@/routes/routesList'
import { subsonic } from '@/service/subsonic'
import { useAppStore } from '@/store/app.store'
import { waitForHydration } from '@/store/hydration'

export async function loginLoader() {
  // Wait for store hydration before checking auth
  await waitForHydration()
  
  const { url, username, password, isServerConfigured } =
    useAppStore.getState().data

  const hasUrl = url || url !== ''
  const hasPassword = password || password !== ''
  const hasUser = username || username !== ''

  if (hasUrl && hasPassword && hasUser && isServerConfigured) {
    const isServerUp = await subsonic.ping.pingView()
    if (isServerUp) return redirect(ROUTES.LIBRARY.HOME)
  }

  return null
}
