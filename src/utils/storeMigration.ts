import { toast } from 'react-toastify'
import { set } from 'idb-keyval'

interface MigrationResult {
  success: boolean
  migratedStores: string[]
  errors: string[]
}

export async function migrateLocalStorageToIndexedDB(
  t: (key: string) => string,
): Promise<MigrationResult> {
  const MIGRATION_KEY = 'storage-migration-completed'
  const stores = ['player_store', 'app_store', 'theme_store', 'lang_store']

  // Check if already migrated
  const alreadyMigrated = localStorage.getItem(MIGRATION_KEY)
  if (alreadyMigrated) {
    return { success: true, migratedStores: [], errors: [] }
  }

  // Show loading toast
  toast(t('storage.migration.started'), {
    autoClose: false,
    type: 'default',
    isLoading: true,
    toastId: 'storage-migration',
  })

  const migratedStores: string[] = []
  const errors: string[] = []

  for (const storeName of stores) {
    try {
      const data = localStorage.getItem(storeName)

      if (data) {
        // Write to IndexedDB
        await set(storeName, data)
        migratedStores.push(storeName)

        // Keep localStorage data as backup initially
        // Don't remove yet in case rollback is needed
      }
    } catch (error) {
      console.error(`Failed to migrate ${storeName}:`, error)
      errors.push(storeName)
    }
  }

  if (errors.length === 0) {
    // Mark migration complete
    localStorage.setItem(MIGRATION_KEY, 'true')
    
    // Store flag to show success message after reload
    sessionStorage.setItem('migration-just-completed', 'true')

    toast.update('storage-migration', {
      render: t('storage.migration.success'),
      type: 'success',
      autoClose: 1000,
      isLoading: false,
    })

    // Reload page after short delay so stores can hydrate from IndexedDB
    setTimeout(() => {
      window.location.reload()
    }, 1000)

    return { success: true, migratedStores, errors }
  } else {
    toast.update('storage-migration', {
      render: t('storage.migration.error'),
      type: 'error',
      autoClose: 10000,
      isLoading: false,
    })

    return { success: false, migratedStores, errors }
  }
}

