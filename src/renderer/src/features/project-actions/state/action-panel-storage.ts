import type { StateStorage } from 'zustand/middleware'

const memoryStorage = new Map<string, string>()

/** Local storage for private panel state, with an in-memory fallback outside the browser. */
export function resolveActionPanelStorage(): StateStorage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  return {
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => {
      memoryStorage.set(key, value)
    },
    removeItem: (key) => {
      memoryStorage.delete(key)
    },
  }
}
