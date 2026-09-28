import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { resolveActionPanelStorage } from './action-panel-storage'

export const SCRIPT_COMMAND_MEMORY_STORAGE_KEY = 'openwaggle:action-panel:script-commands:v1'
const MAX_REMEMBERED_SCRIPT_COMMANDS = 500

/**
 * The last command seen for each linked script, per project, kept privately on this device. It
 * offers "Use the last known command instead" when a linked script is missing from a workspace.
 * Stored apart from drafts so typing in the panel never rewrites this map.
 */
interface ScriptCommandMemoryState {
  readonly commands: Readonly<Record<string, string>>
  remember: (key: string, command: string) => void
}

export function scriptCommandMemoryKey(projectPath: string, scriptKey: string) {
  return `${projectPath}\u0000${scriptKey}`
}

function sanitize(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .slice(-MAX_REMEMBERED_SCRIPT_COMMANDS),
  )
}

export const useScriptCommandMemory = create<ScriptCommandMemoryState>()(
  persist(
    (set, get) => ({
      commands: {},
      remember: (key, command) => {
        if (!command || get().commands[key] === command) return
        set({ commands: sanitize({ ...get().commands, [key]: command }) })
      },
    }),
    {
      name: SCRIPT_COMMAND_MEMORY_STORAGE_KEY,
      storage: createJSONStorage(resolveActionPanelStorage),
      partialize: (state) => ({ commands: state.commands }),
      merge: (persisted, current) => ({
        ...current,
        commands: sanitize(
          persisted !== null && typeof persisted === 'object'
            ? Reflect.get(persisted, 'commands')
            : undefined,
        ),
      }),
    },
  ),
)
