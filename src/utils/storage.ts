import { StateStorage } from 'zustand/middleware'
import { get, set, del } from 'idb-keyval'

export const indexedDBStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const value = (await get(name)) || null
    return value
  },
  setItem: async (name: string, value: string): Promise<void> => {
    console.log(`[IndexedDB] Setting ${name}: ${value.length} chars`)
    await set(name, value)
  },
  removeItem: async (name: string): Promise<void> => {
    console.log(`[IndexedDB] Removing: ${name}`)
    await del(name)
  },
}

