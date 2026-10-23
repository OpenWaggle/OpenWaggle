import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

interface ScheduledTasksPreferencesState {
  /** The one-time Background start offer after the first Scheduled task (ADR 0057). */
  readonly backgroundStartOfferDismissed: boolean
  readonly dismissBackgroundStartOffer: () => void
}

/** Memory-backed storage so the store is safe to construct without a DOM (tests). */
function resolveStorage(): StateStorage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  const memory = new Map<string, string>()
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value)
    },
    removeItem: (key) => {
      memory.delete(key)
    },
  }
}

export const useScheduledTasksPreferencesStore = create<ScheduledTasksPreferencesState>()(
  persist(
    (set) => ({
      backgroundStartOfferDismissed: false,
      dismissBackgroundStartOffer: () => set({ backgroundStartOfferDismissed: true }),
    }),
    { name: 'openwaggle:scheduled-tasks:v1', storage: createJSONStorage(resolveStorage) },
  ),
)
