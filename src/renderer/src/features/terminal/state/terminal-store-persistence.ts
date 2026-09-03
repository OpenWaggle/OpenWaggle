import { createJSONStorage, type StateStorage } from 'zustand/middleware'
import type {
  TerminalGroupState,
  TerminalPaneState,
  TerminalSplitDirection,
  TerminalTabState,
} from './terminal-store'

export const TERMINAL_STORAGE_KEY = 'openwaggle:terminal-layout:v1'
const TERMINAL_WRITE_DELAY_MS = 500
export const TERMINAL_PANEL_DEFAULT_HEIGHT = 228
export const MIN_PANEL_HEIGHT = 120
export const MAX_PANEL_HEIGHT = 720

/** Memory-backed storage so the store is safe to construct without a DOM (tests). */
export function resolveTerminalStorage(): StateStorage {
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

/** Defer and coalesce writes so bursty terminal layout changes cost one write. */
export function debouncedTerminalStorage(
  inner: StateStorage,
  delayMs = TERMINAL_WRITE_DELAY_MS,
): StateStorage {
  const pending = new Map<string, string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  function flush() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    for (const [key, value] of pending) inner.setItem(key, value)
    pending.clear()
  }

  if (typeof window !== 'undefined') window.addEventListener('pagehide', flush)

  return {
    getItem: (key) => {
      const queued = pending.get(key)
      if (queued !== undefined) return queued
      return inner.getItem(key)
    },
    setItem: (key, value) => {
      pending.set(key, value)
      if (timer === null) timer = setTimeout(flush, delayMs)
    },
    removeItem: (key) => {
      pending.delete(key)
      inner.removeItem(key)
    },
  }
}

export function readStoredField(source: unknown, key: string): unknown {
  if (source === null || typeof source !== 'object') return undefined
  return Reflect.get(source, key)
}

/** A pane state is valid only with non-empty string id and cwd. */
function sanitizePanes(value: unknown): TerminalPaneState[] {
  if (!Array.isArray(value)) return []
  const panes: TerminalPaneState[] = []
  for (const entry of value) {
    const pane = sanitizePane(entry)
    if (pane !== null) panes.push(pane)
  }
  return panes
}

function sanitizePane(entry: unknown): TerminalPaneState | null {
  const terminalId = readStoredField(entry, 'terminalId')
  const cwd = readStoredField(entry, 'cwd')
  if (typeof terminalId !== 'string' || terminalId.length === 0) return null
  if (typeof cwd !== 'string' || cwd.length === 0) return null
  return { terminalId, cwd }
}

function sanitizeSplitDirection(value: unknown): TerminalSplitDirection {
  return value === 'stacked' ? 'stacked' : 'side-by-side'
}

function sanitizeTab(entry: unknown): TerminalTabState | null {
  const id = readStoredField(entry, 'id')
  const panes = sanitizePanes(readStoredField(entry, 'panes'))
  if (typeof id !== 'string' || id.length === 0 || panes.length === 0) return null
  const customName: unknown = readStoredField(entry, 'customName')
  return {
    id,
    panes,
    splitDirection: sanitizeSplitDirection(readStoredField(entry, 'splitDirection')),
    customName: typeof customName === 'string' && customName.length > 0 ? customName : null,
  }
}

function sanitizeTabs(value: unknown): TerminalTabState[] {
  if (!Array.isArray(value)) return []
  const tabs: TerminalTabState[] = []
  for (const entry of value) {
    const tab = sanitizeTab(entry)
    if (tab !== null) tabs.push(tab)
  }
  return tabs
}

function sanitizeActiveTabId(value: unknown, tabs: readonly TerminalTabState[]) {
  if (typeof value === 'string' && tabs.some((tab) => tab.id === value)) return value
  return tabs[tabs.length - 1].id
}

/** Keep only structurally valid tabs and groups, so a corrupt entry cannot poison the panel. */
export function sanitizeStoredGroups(value: unknown): Record<string, TerminalGroupState> {
  const groups: Record<string, TerminalGroupState> = {}
  if (value === null || typeof value !== 'object') return groups
  for (const ownerKey of Object.keys(value)) {
    if (ownerKey.length === 0) continue
    const group: unknown = Reflect.get(value, ownerKey)
    if (group === null || typeof group !== 'object') continue
    const tabs = sanitizeTabs(readStoredField(group, 'tabs'))
    if (tabs.length === 0) continue
    groups[ownerKey] = {
      tabs,
      activeTabId: sanitizeActiveTabId(readStoredField(group, 'activeTabId'), tabs),
    }
  }
  return groups
}

export function sanitizeStoredPanelHeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return TERMINAL_PANEL_DEFAULT_HEIGHT
  return Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, Math.round(value)))
}

export function terminalStorageOptions() {
  return createJSONStorage(() => debouncedTerminalStorage(resolveTerminalStorage()))
}
