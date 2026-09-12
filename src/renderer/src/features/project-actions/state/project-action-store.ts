import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

const PROJECT_ACTION_STATE_KEY = 'openwaggle:project-actions:v1'

interface ProjectActionState {
  readonly lastInvokedByProject: Readonly<Record<string, string>>
  rememberInvoked: (projectPath: string, actionId: string) => void
}

function projectActionStorage(): StateStorage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  const memory = new Map<string, string>()
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  }
}

export const useProjectActionStore = create<ProjectActionState>()(
  persist(
    (set) => ({
      lastInvokedByProject: {},
      rememberInvoked: (projectPath, actionId) => {
        if (projectPath.length === 0 || actionId.length === 0) return
        set((state) => ({
          lastInvokedByProject: { ...state.lastInvokedByProject, [projectPath]: actionId },
        }))
      },
    }),
    {
      name: PROJECT_ACTION_STATE_KEY,
      storage: createJSONStorage(projectActionStorage),
      partialize: (state) => ({ lastInvokedByProject: state.lastInvokedByProject }),
    },
  ),
)
