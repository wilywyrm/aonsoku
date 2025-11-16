import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-toastify'
import { migrateLocalStorageToIndexedDB } from '@/utils/storeMigration'

export function MigrationObserver() {
  const { t } = useTranslation()
  const [migrationAttempted, setMigrationAttempted] = useState(false)

  useEffect(() => {
    // Check if we just completed migration and reloaded
    const justCompleted = sessionStorage.getItem('migration-just-completed')
    if (justCompleted) {
      sessionStorage.removeItem('migration-just-completed')
      toast.success(t('storage.migration.success'), {
        autoClose: 5000,
      })
    }

    const runMigration = async () => {
      if (migrationAttempted) return

      setMigrationAttempted(true)

      try {
        await migrateLocalStorageToIndexedDB(t)
      } catch (error) {
        console.error('Migration failed:', error)
      }
    }

    runMigration()
  }, [t, migrationAttempted])

  return null
}


