import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalOwnerKey } from '@shared/types/terminal'
import type { TerminalLaunchEnvironment } from '../lib/terminal-launch-environment'
import { TERMINAL_PANEL_DEFAULT_HEIGHT } from './terminal-store-persistence'
import { omitRuntimeKeys } from './terminal-store-runtime'
import type {
  TerminalGroupState,
  TerminalPaneState,
  TerminalStateGetter,
  TerminalStateSetter,
  TerminalTabState,
} from './terminal-store-types'

const ID_RANDOM_RADIX = 36
const ID_RANDOM_SUFFIX_LENGTH = 10
const ID_RANDOM_START_OFFSET = 2

function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.random()
        .toString(ID_RANDOM_RADIX)
        .slice(ID_RANDOM_START_OFFSET, ID_RANDOM_START_OFFSET + ID_RANDOM_SUFFIX_LENGTH)}`
}

export function withGroup(
  groups: Record<TerminalOwnerKey, TerminalGroupState>,
  ownerKey: TerminalOwnerKey,
  update: (group: TerminalGroupState) => TerminalGroupState,
) {
  const existing = groups[ownerKey] ?? {
    tabs: [],
    activeTabId: null,
    panelOpen: false,
    panelHeight: TERMINAL_PANEL_DEFAULT_HEIGHT,
  }
  return { ...groups, [ownerKey]: update(existing) }
}

export function updateTab(
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

export function createTerminalAction(
  set: TerminalStateSetter,
  ownerKey: string,
  cwd: string,
  launchEnv?: TerminalLaunchEnvironment,
) {
  if (cwd.length === 0) return null
  const terminalId = makeId()
  const pane: TerminalPaneState = { terminalId, cwd, ...(launchEnv ? { launchEnv } : {}) }
  const tab: TerminalTabState = {
    id: makeId(),
    panes: [pane],
    activePaneId: terminalId,
    splitDirection: 'side-by-side',
    customName: null,
  }
  set((state) => ({
    groups: withGroup(state.groups, ownerKey, (group) => ({
      ...group,
      tabs: [...group.tabs, tab],
      activeTabId: tab.id,
    })),
    exits: omitRuntimeKeys(state, ownerKey, [terminalId]).exits,
  }))
  return terminalId
}

export function ensureTerminalAction(
  set: TerminalStateSetter,
  ownerKey: string,
  terminalId: string,
  cwd: string,
  options: { readonly launchEnv?: TerminalLaunchEnvironment; readonly customName?: string } = {},
) {
  if (ownerKey.length === 0 || terminalId.length === 0 || cwd.length === 0) return
  set((state) => ({
    groups: withGroup(state.groups, ownerKey, (group) => {
      const existingTab = group.tabs.find((tab) =>
        tab.panes.some((pane) => pane.terminalId === terminalId),
      )
      if (existingTab !== undefined) {
        return {
          ...group,
          tabs: group.tabs.map((tab) =>
            tab.id === existingTab.id
              ? {
                  ...tab,
                  customName: options.customName ?? tab.customName,
                  panes: tab.panes.map((pane) =>
                    pane.terminalId === terminalId
                      ? {
                          ...pane,
                          cwd,
                          ...(options.launchEnv ? { launchEnv: options.launchEnv } : {}),
                        }
                      : pane,
                  ),
                }
              : tab,
          ),
        }
      }
      const tabId = `setup-${terminalId}`
      return {
        ...group,
        panelOpen: true,
        activeTabId: tabId,
        tabs: [
          ...group.tabs,
          {
            id: tabId,
            panes: [
              { terminalId, cwd, ...(options.launchEnv ? { launchEnv: options.launchEnv } : {}) },
            ],
            activePaneId: terminalId,
            splitDirection: 'side-by-side',
            customName: options.customName ?? null,
          },
        ],
      }
    }),
    exits: omitRuntimeKeys(state, ownerKey, [terminalId]).exits,
  }))
}

export function splitTerminalAction(
  get: TerminalStateGetter,
  set: TerminalStateSetter,
  ownerKey: string,
  tabId: string,
  cwd: string,
  launchEnv?: TerminalLaunchEnvironment,
) {
  const tab = get().groups[ownerKey]?.tabs.find((candidate) => candidate.id === tabId)
  const full = tab !== undefined && tab.panes.length >= TERMINAL.MAX_PANES_PER_TAB
  if (tab === undefined || full || cwd.length === 0) return null
  const terminalId = makeId()
  set((state) => ({
    groups: withGroup(state.groups, ownerKey, (group) =>
      updateTab(group, tabId, (target) => ({
        ...target,
        panes: [...target.panes, { terminalId, cwd, ...(launchEnv ? { launchEnv } : {}) }],
        activePaneId: terminalId,
      })),
    ),
  }))
  return terminalId
}

export function closePaneAction(set: TerminalStateSetter, ownerKey: string, terminalId: string) {
  set((state) => {
    const group = state.groups[ownerKey]
    if (group === undefined) return {}
    const target = group.tabs.find((tab) =>
      tab.panes.some((pane) => pane.terminalId === terminalId),
    )
    if (target === undefined) return {}
    const closingIndex = target.panes.findIndex((pane) => pane.terminalId === terminalId)
    const remainingPanes = target.panes.filter((pane) => pane.terminalId !== terminalId)
    const tabs =
      remainingPanes.length > 0
        ? updateTab(group, target.id, (tab) => ({
            ...tab,
            panes: remainingPanes,
            activePaneId:
              tab.activePaneId === terminalId
                ? (remainingPanes[Math.min(closingIndex, remainingPanes.length - 1)]?.terminalId ??
                  remainingPanes[0].terminalId)
                : tab.activePaneId,
          })).tabs
        : group.tabs.filter((tab) => tab.id !== target.id)
    const activeTabId =
      remainingPanes.length > 0 || group.activeTabId !== target.id
        ? group.activeTabId
        : (tabs[tabs.length - 1]?.id ?? null)
    return {
      groups: { ...state.groups, [ownerKey]: { ...group, tabs, activeTabId } },
      ...omitRuntimeKeys(state, ownerKey, [terminalId]),
    }
  })
}

export function transferTabs(
  groups: Record<TerminalOwnerKey, TerminalGroupState>,
  fromOwnerKey: TerminalOwnerKey,
  toOwnerKey: TerminalOwnerKey,
  tabIds: ReadonlySet<string>,
) {
  if (fromOwnerKey === toOwnerKey || fromOwnerKey.length === 0 || toOwnerKey.length === 0) {
    return groups
  }
  const source = groups[fromOwnerKey]
  if (source === undefined) return groups
  const moving = source.tabs.filter((tab) => tabIds.has(tab.id))
  if (moving.length === 0) return groups
  const target = groups[toOwnerKey] ?? {
    tabs: [],
    activeTabId: null,
    panelOpen: false,
    panelHeight: TERMINAL_PANEL_DEFAULT_HEIGHT,
  }
  const movingTerminalIds = new Set(
    moving.flatMap((tab) => tab.panes.map((pane) => pane.terminalId)),
  )
  const collision = target.tabs.some((tab) =>
    tab.panes.some((pane) => movingTerminalIds.has(pane.terminalId)),
  )
  if (collision) return groups

  const sourceTabs = source.tabs.filter((tab) => !tabIds.has(tab.id))
  const nextSourceActive = sourceTabs.some((tab) => tab.id === source.activeTabId)
    ? source.activeTabId
    : (sourceTabs[sourceTabs.length - 1]?.id ?? null)
  const nextTargetTabs = [...target.tabs, ...moving]
  return {
    ...groups,
    [fromOwnerKey]: {
      ...source,
      tabs: sourceTabs,
      activeTabId: nextSourceActive,
      panelOpen: sourceTabs.length > 0 && source.panelOpen,
    },
    [toOwnerKey]: {
      ...target,
      tabs: nextTargetTabs,
      activeTabId: moving[moving.length - 1]?.id ?? target.activeTabId,
      panelOpen: true,
    },
  }
}
