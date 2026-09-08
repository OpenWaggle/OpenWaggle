import { TERMINAL } from '@shared/constants/resource-limits'
import { isAllowedTerminalEnvironmentName } from '@shared/utils/terminal-environment'
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
const textEncoder = new TextEncoder()

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
function sanitizePanes(value: unknown, terminalIds: Set<string>): TerminalPaneState[] {
  if (!Array.isArray(value)) return []
  const panes: TerminalPaneState[] = []
  for (const entry of value) {
    if (terminalIds.size >= TERMINAL.MAX_TERMINALS_PER_OWNER) break
    const pane = sanitizePane(entry)
    if (pane === null || terminalIds.has(pane.terminalId)) continue
    terminalIds.add(pane.terminalId)
    panes.push(pane)
    if (panes.length >= TERMINAL.MAX_PANES_PER_TAB) break
  }
  return panes
}

function sanitizeLaunchEnv(value: unknown) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const launchEnv: Record<string, string> = {}
  let entries = 0
  let totalBytes = 0
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue
    entries += 1
    const entry: unknown = Reflect.get(value, key)
    if (
      entries > TERMINAL.ENV_MAX_ENTRIES ||
      key.length === 0 ||
      key.length > TERMINAL.ENV_KEY_MAX_LENGTH ||
      !isAllowedTerminalEnvironmentName(key) ||
      typeof entry !== 'string' ||
      entry.length > TERMINAL.ENV_VALUE_MAX_LENGTH ||
      entry.includes('\0')
    ) {
      return undefined
    }
    totalBytes += textEncoder.encode(key).byteLength + textEncoder.encode(entry).byteLength
    if (totalBytes > TERMINAL.ENV_TOTAL_MAX_BYTES) return undefined
    launchEnv[key] = entry
  }
  return Object.keys(launchEnv).length > 0 ? launchEnv : undefined
}

function sanitizePane(entry: unknown): TerminalPaneState | null {
  const terminalId = readStoredField(entry, 'terminalId')
  const cwd = readStoredField(entry, 'cwd')
  if (
    typeof terminalId !== 'string' ||
    terminalId.length === 0 ||
    terminalId.length > TERMINAL.TERMINAL_ID_MAX_LENGTH ||
    terminalId.includes('\0')
  ) {
    return null
  }
  if (
    typeof cwd !== 'string' ||
    cwd.length === 0 ||
    cwd.length > TERMINAL.CWD_PATH_MAX_LENGTH ||
    cwd.includes('\0')
  ) {
    return null
  }
  const launchEnv = sanitizeLaunchEnv(readStoredField(entry, 'launchEnv'))
  return { terminalId, cwd, ...(launchEnv ? { launchEnv } : {}) }
}

function sanitizeSplitDirection(value: unknown): TerminalSplitDirection {
  return value === 'stacked' ? 'stacked' : 'side-by-side'
}

function sanitizeTab(entry: unknown, terminalIds: Set<string>): TerminalTabState | null {
  const id = readStoredField(entry, 'id')
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    id.length > TERMINAL.TERMINAL_ID_MAX_LENGTH ||
    id.includes('\0')
  ) {
    return null
  }
  const panes = sanitizePanes(readStoredField(entry, 'panes'), terminalIds)
  if (panes.length === 0) return null
  const customName: unknown = readStoredField(entry, 'customName')
  const storedActivePaneId = readStoredField(entry, 'activePaneId')
  const activePaneId =
    typeof storedActivePaneId === 'string' &&
    panes.some((pane) => pane.terminalId === storedActivePaneId)
      ? storedActivePaneId
      : panes[0].terminalId
  return {
    id,
    panes,
    activePaneId,
    splitDirection: sanitizeSplitDirection(readStoredField(entry, 'splitDirection')),
    customName:
      typeof customName === 'string' &&
      customName.length > 0 &&
      customName.length <= TERMINAL.TAB_NAME_MAX_LENGTH &&
      !customName.includes('\0')
        ? customName
        : null,
  }
}

function sanitizeTabs(value: unknown): TerminalTabState[] {
  if (!Array.isArray(value)) return []
  const tabs: TerminalTabState[] = []
  const tabIds = new Set<string>()
  const terminalIds = new Set<string>()
  for (const entry of value) {
    const storedId = readStoredField(entry, 'id')
    if (typeof storedId === 'string' && tabIds.has(storedId)) continue
    const tab = sanitizeTab(entry, terminalIds)
    if (tab === null || tabIds.has(tab.id)) continue
    tabIds.add(tab.id)
    tabs.push(tab)
    if (tabs.length >= TERMINAL.MAX_TABS_PER_GROUP) break
  }
  return tabs
}

function sanitizeActiveTabId(value: unknown, tabs: readonly TerminalTabState[]) {
  if (typeof value === 'string' && tabs.some((tab) => tab.id === value)) return value
  return tabs[tabs.length - 1].id
}

/** Keep only structurally valid tabs and groups, so a corrupt entry cannot poison the panel. */
export function sanitizeStoredGroups(
  value: unknown,
  legacyPanelHeight = TERMINAL_PANEL_DEFAULT_HEIGHT,
): Record<string, TerminalGroupState> {
  const groups: Record<string, TerminalGroupState> = {}
  let groupCount = 0
  if (value === null || typeof value !== 'object') return groups
  for (const ownerKey of Object.keys(value)) {
    if (
      ownerKey.length === 0 ||
      ownerKey.length > TERMINAL.OWNER_KEY_MAX_LENGTH ||
      ownerKey.includes('\0')
    ) {
      continue
    }
    const group: unknown = Reflect.get(value, ownerKey)
    if (group === null || typeof group !== 'object') continue
    const tabs = sanitizeTabs(readStoredField(group, 'tabs'))
    if (tabs.length === 0) continue
    groups[ownerKey] = {
      tabs,
      activeTabId: sanitizeActiveTabId(readStoredField(group, 'activeTabId'), tabs),
      panelOpen: readStoredField(group, 'panelOpen') === true,
      panelHeight: sanitizeStoredPanelHeight(
        readStoredField(group, 'panelHeight') ?? legacyPanelHeight,
      ),
    }
    groupCount += 1
    if (groupCount >= TERMINAL.MAX_STORED_GROUPS) break
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
