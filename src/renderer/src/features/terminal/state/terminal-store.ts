import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalOwnerKey, TerminalRuntimeEvent } from '@shared/types/terminal'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { runtimeKeyOf } from '../lib/terminal-owner'
import {
  MAX_PANEL_HEIGHT,
  MIN_PANEL_HEIGHT,
  readStoredField,
  sanitizeStoredGroups,
  sanitizeStoredPanelHeight,
  TERMINAL_PANEL_DEFAULT_HEIGHT,
  TERMINAL_STORAGE_KEY,
  terminalStorageOptions,
} from './terminal-store-persistence'

// Renderer layout state for Session terminals (ADR 0030). Processes live in
// the main process; this store owns layout, names, and transient chips.

export type TerminalSplitDirection = 'side-by-side' | 'stacked'

export interface TerminalPaneState {
  /** Client-chosen terminal id, unique per owner. */
  readonly terminalId: string
  /** Launch context Working path, fixed at creation. */
  readonly cwd: string
}

export interface TerminalTabState {
  readonly id: string
  readonly panes: readonly TerminalPaneState[]
  readonly splitDirection: TerminalSplitDirection
  readonly customName: string | null
}

export interface TerminalGroupState {
  readonly tabs: readonly TerminalTabState[]
  readonly activeTabId: string | null
}

const ID_RANDOM_RADIX = 36
const ID_RANDOM_SUFFIX_LENGTH = 10
const ID_RANDOM_START_OFFSET = 2

interface TerminalState {
  readonly groups: Record<TerminalOwnerKey, TerminalGroupState>
  readonly panelHeight: number
  /** Keyed by runtimeKeyOf: foreground process, listening ports, last exit. */
  readonly activity: Record<string, string | null>
  readonly portPreviews: Record<string, readonly number[]>
  readonly exits: Record<string, number>
  createTerminal: (ownerKey: TerminalOwnerKey, cwd: string) => string | null
  splitTerminal: (ownerKey: TerminalOwnerKey, tabId: string, cwd: string) => string | null
  setSplitDirection: (
    ownerKey: TerminalOwnerKey,
    tabId: string,
    direction: TerminalSplitDirection,
  ) => void
  closePane: (ownerKey: TerminalOwnerKey, terminalId: string) => void
  closeTab: (ownerKey: TerminalOwnerKey, tabId: string) => readonly string[]
  renameTab: (ownerKey: TerminalOwnerKey, tabId: string, name: string | null) => void
  setActiveTab: (ownerKey: TerminalOwnerKey, tabId: string) => void
  removeGroup: (ownerKey: TerminalOwnerKey) => void
  setPanelHeight: (height: number) => void
  applyRuntimeEvent: (
    ownerKey: TerminalOwnerKey,
    terminalId: string,
    event: TerminalRuntimeEvent,
  ) => void
  clearExit: (ownerKey: TerminalOwnerKey, terminalId: string) => void
}

function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.random()
        .toString(ID_RANDOM_RADIX)
        .slice(ID_RANDOM_START_OFFSET, ID_RANDOM_START_OFFSET + ID_RANDOM_SUFFIX_LENGTH)}`
}

/** Zustand set/get narrowed to this store's shape. */
type TerminalStateSetter = (
  partial: Partial<TerminalState> | ((state: TerminalState) => Partial<TerminalState>),
) => void

/** Group transforms shared by the layout actions below. */
function withGroup(
  groups: Record<TerminalOwnerKey, TerminalGroupState>,
  ownerKey: TerminalOwnerKey,
  update: (group: TerminalGroupState) => TerminalGroupState,
) {
  const existing = groups[ownerKey] ?? { tabs: [], activeTabId: null }
  return { ...groups, [ownerKey]: update(existing) }
}

function updateTab(
  group: TerminalGroupState,
  tabId: string,
  update: (tab: TerminalTabState) => TerminalTabState,
) {
  const index = group.tabs.findIndex((tab) => tab.id === tabId)
  if (index === -1) return group
  const tabs = [...group.tabs]
  tabs[index] = update(tabs[index])
  return { ...group, tabs }
}

function createTerminalAction(set: TerminalStateSetter, ownerKey: string, cwd: string) {
  if (cwd.length === 0) return null
  const terminalId = makeId()
  const pane: TerminalPaneState = { terminalId, cwd }
  const tab: TerminalTabState = {
    id: makeId(),
    panes: [pane],
    splitDirection: 'side-by-side',
    customName: null,
  }
  set((state) => ({
    groups: withGroup(state.groups, ownerKey, (group) => ({
      tabs: [...group.tabs, tab],
      activeTabId: tab.id,
    })),
    exits: omitRuntimeKeys(state, ownerKey, [terminalId]).exits,
  }))
  return terminalId
}

function splitTerminalAction(
  get: () => TerminalState,
  set: TerminalStateSetter,
  ownerKey: string,
  tabId: string,
  cwd: string,
) {
  const tab = get().groups[ownerKey]?.tabs.find((candidate) => candidate.id === tabId)
  const full = tab !== undefined && tab.panes.length >= TERMINAL.MAX_PANES_PER_TAB
  if (tab === undefined || full || cwd.length === 0) return null
  const terminalId = makeId()
  set((state) => ({
    groups: withGroup(state.groups, ownerKey, (group) =>
      updateTab(group, tabId, (target) => ({
        ...target,
        panes: [...target.panes, { terminalId, cwd }],
      })),
    ),
  }))
  return terminalId
}

function closePaneAction(set: TerminalStateSetter, ownerKey: string, terminalId: string) {
  set((state) => {
    const group = state.groups[ownerKey]
    if (group === undefined) return {}
    const target = group.tabs.find((tab) =>
      tab.panes.some((pane) => pane.terminalId === terminalId),
    )
    if (target === undefined) return {}
    const remainingPanes = target.panes.filter((pane) => pane.terminalId !== terminalId)
    const tabs =
      remainingPanes.length > 0
        ? updateTab(group, target.id, (tab) => ({ ...tab, panes: remainingPanes })).tabs
        : group.tabs.filter((tab) => tab.id !== target.id)
    const activeTabId =
      remainingPanes.length > 0 || group.activeTabId !== target.id
        ? group.activeTabId
        : (tabs[tabs.length - 1]?.id ?? null)
    return {
      groups: { ...state.groups, [ownerKey]: { tabs, activeTabId } },
      ...omitRuntimeKeys(state, ownerKey, [terminalId]),
    }
  })
}

function omitRuntimeKeys(
  state: TerminalState,
  ownerKey: TerminalOwnerKey,
  terminalIds: readonly string[],
) {
  function drop<V>(record: Record<string, V>) {
    const next = { ...record }
    for (const terminalId of terminalIds) delete next[runtimeKeyOf(ownerKey, terminalId)]
    return next
  }
  return {
    activity: drop(state.activity),
    portPreviews: drop(state.portPreviews),
    exits: drop(state.exits),
  }
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      groups: {},
      panelHeight: TERMINAL_PANEL_DEFAULT_HEIGHT,
      activity: {},
      portPreviews: {},
      exits: {},

      createTerminal: (ownerKey, cwd) => createTerminalAction(set, ownerKey, cwd),

      splitTerminal: (ownerKey, tabId, cwd) => splitTerminalAction(get, set, ownerKey, tabId, cwd),

      setSplitDirection: (ownerKey, tabId, direction) => {
        set((state) => ({
          groups: withGroup(state.groups, ownerKey, (group) =>
            updateTab(group, tabId, (tab) => ({ ...tab, splitDirection: direction })),
          ),
        }))
      },

      closePane: (ownerKey, terminalId) => closePaneAction(set, ownerKey, terminalId),

      closeTab: (ownerKey, tabId) => {
        const target = get().groups[ownerKey]?.tabs.find((tab) => tab.id === tabId)
        if (target === undefined) return []
        const closedIds = target.panes.map((pane) => pane.terminalId)
        set((state) => {
          const group = state.groups[ownerKey]
          if (group === undefined) return {}
          const tabs = group.tabs.filter((tab) => tab.id !== tabId)
          return {
            groups: withGroup(state.groups, ownerKey, () => ({
              tabs,
              activeTabId: tabs[tabs.length - 1]?.id ?? null,
            })),
            ...omitRuntimeKeys(state, ownerKey, closedIds),
          }
        })
        return closedIds
      },

      renameTab: (ownerKey, tabId, name) => {
        set((state) => ({
          groups: withGroup(state.groups, ownerKey, (group) =>
            updateTab(group, tabId, (tab) => ({
              ...tab,
              customName: name !== null && name.trim().length > 0 ? name.trim() : null,
            })),
          ),
        }))
      },

      setActiveTab: (ownerKey, tabId) => {
        set((state) => ({
          groups: withGroup(state.groups, ownerKey, (group) => ({ ...group, activeTabId: tabId })),
        }))
      },

      removeGroup: (ownerKey) => {
        set((state) => {
          const groups = { ...state.groups }
          delete groups[ownerKey]
          return { groups }
        })
      },

      setPanelHeight: (height) => {
        set({
          panelHeight: Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, Math.round(height))),
        })
      },

      applyRuntimeEvent: (ownerKey, terminalId, event) => {
        const runtime = runtimeKeyOf(ownerKey, terminalId)
        if (event.type === 'activity') {
          set((state) => ({ activity: { ...state.activity, [runtime]: event.processName } }))
          return
        }
        if (event.type === 'ports') {
          set((state) => ({ portPreviews: { ...state.portPreviews, [runtime]: [...event.ports] } }))
          return
        }
        if (event.type === 'exited') {
          set((state) => ({ exits: { ...state.exits, [runtime]: event.exitCode } }))
        }
      },

      clearExit: (ownerKey, terminalId) => {
        set((state) => ({ exits: omitRuntimeKeys(state, ownerKey, [terminalId]).exits }))
      },
    }),
    {
      name: TERMINAL_STORAGE_KEY,
      version: 1,
      storage: terminalStorageOptions(),
      // Only user-authored layout survives a reload; runtime chips re-derive
      // from live terminals and are deliberately dropped.
      partialize: (state) => ({
        groups: state.groups,
        panelHeight: state.panelHeight,
      }),
      merge: (persisted, current) => ({
        ...current,
        groups: sanitizeStoredGroups(readStoredField(persisted, 'groups')),
        panelHeight: sanitizeStoredPanelHeight(readStoredField(persisted, 'panelHeight')),
      }),
    },
  ),
)
