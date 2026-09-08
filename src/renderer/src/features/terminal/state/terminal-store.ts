import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createTerminalState } from './terminal-store-actions'
import {
  readStoredField,
  sanitizeStoredGroups,
  sanitizeStoredPanelHeight,
  TERMINAL_STORAGE_KEY,
  terminalStorageOptions,
} from './terminal-store-persistence'
import type { TerminalState } from './terminal-store-types'

export type {
  TerminalGroupState,
  TerminalPaneState,
  TerminalSplitDirection,
  TerminalTabState,
} from './terminal-store-types'

const TERMINAL_PERSISTENCE_VERSION = 2

export const useTerminalStore = create<TerminalState>()(
  persist((set, get) => createTerminalState(set, get), {
    name: TERMINAL_STORAGE_KEY,
    version: TERMINAL_PERSISTENCE_VERSION,
    storage: terminalStorageOptions(),
    // Only user-authored layout survives a reload; runtime chips re-derive
    // from live terminals and are deliberately dropped.
    partialize: (state) => ({ groups: state.groups }),
    // Version one stored a shared panel height. Decode it through the same
    // bounded layout reader as current snapshots before Zustand writes version two.
    migrate: (persisted) => ({
      groups: sanitizeStoredGroups(
        readStoredField(persisted, 'groups'),
        sanitizeStoredPanelHeight(readStoredField(persisted, 'panelHeight')),
      ),
    }),
    merge: (persisted, current) => ({
      ...current,
      groups: sanitizeStoredGroups(
        readStoredField(persisted, 'groups'),
        sanitizeStoredPanelHeight(readStoredField(persisted, 'panelHeight')),
      ),
    }),
  }),
)
