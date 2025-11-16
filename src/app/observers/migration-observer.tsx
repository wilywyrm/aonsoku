import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { migrateLocalStorageToIndexedDB } from '@/utils/storeMigration'

export function MigrationObserver() {
  const { t } = useTranslation()
  const [migrationAttempted, setMigrationAttempted] = useState(false)

  useEffect(() => {
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

