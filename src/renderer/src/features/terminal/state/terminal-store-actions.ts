import { sameTerminalLaunchEnvironment } from '../lib/terminal-launch-environment'
import { runtimeKeyOf, terminalSidePanelLayoutKey } from '../lib/terminal-owner'
import { updateTab, withGroup } from './terminal-store-layout'
import { createLifecycleActions } from './terminal-store-lifecycle'
import { MAX_PANEL_HEIGHT, MIN_PANEL_HEIGHT } from './terminal-store-persistence'
import {
  omitRuntimeKeys,
  omitRuntimeOwners,
  rekeyRuntimeMetadata as rekeyRuntimeState,
} from './terminal-store-runtime'
import type {
  TerminalState,
  TerminalStateGetter,
  TerminalStateSetter,
} from './terminal-store-types'

type LayoutActions = Pick<
  TerminalState,
  | 'setSplitDirection'
  | 'renameTab'
  | 'setActiveTab'
  | 'setActivePane'
  | 'setPaneCwd'
  | 'setPaneLaunchEnv'
>

function createLayoutActions(set: TerminalStateSetter): LayoutActions {
  return {
    setSplitDirection: (ownerKey, tabId, direction) => {
      set((state) => ({
        groups: withGroup(state.groups, ownerKey, (group) =>
          updateTab(group, tabId, (tab) => ({ ...tab, splitDirection: direction })),
        ),
      }))
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
        groups: withGroup(state.groups, ownerKey, (group) =>
          group.tabs.some((tab) => tab.id === tabId) ? { ...group, activeTabId: tabId } : group,
        ),
      }))
    },

    setActivePane: (ownerKey, tabId, terminalId) => {
      set((state) => ({
        groups: withGroup(state.groups, ownerKey, (group) =>
          updateTab(group, tabId, (tab) =>
            tab.panes.some((pane) => pane.terminalId === terminalId)
              ? { ...tab, activePaneId: terminalId }
              : tab,
          ),
        ),
      }))
    },

    setPaneCwd: (ownerKey, terminalId, cwd) => {
      if (cwd.length === 0) return
      set((state) => ({
        groups: withGroup(state.groups, ownerKey, (group) => ({
          ...group,
          tabs: group.tabs.map((tab) => ({
            ...tab,
            panes: tab.panes.map((pane) =>
              pane.terminalId === terminalId ? { ...pane, cwd } : pane,
            ),
          })),
        })),
      }))
    },

    setPaneLaunchEnv: (ownerKey, terminalId, launchEnv) => {
      set((state) => ({
        groups: withGroup(state.groups, ownerKey, (group) => ({
          ...group,
          tabs: group.tabs.map((tab) => ({
            ...tab,
            panes: tab.panes.map((pane) =>
              pane.terminalId === terminalId &&
              !sameTerminalLaunchEnvironment(pane.launchEnv, launchEnv)
                ? { ...pane, ...(launchEnv ? { launchEnv } : { launchEnv: undefined }) }
                : pane,
            ),
          })),
        })),
      }))
    },
  }
}

type OwnerActions = Pick<
  TerminalState,
  | 'setPanelOpen'
  | 'removeGroup'
  | 'clearOwnerRuntimeMetadata'
  | 'removeOwner'
  | 'migrateGroup'
  | 'rekeyRuntimeMetadata'
  | 'setPanelHeight'
>

function createOwnerActions(set: TerminalStateSetter): OwnerActions {
  return {
    setPanelOpen: (ownerKey, open) => {
      if (ownerKey.length === 0) return
      set((state) => ({
        groups: withGroup(state.groups, ownerKey, (group) => ({ ...group, panelOpen: open })),
      }))
    },

    removeGroup: (ownerKey) => {
      set((state) => {
        const groups = { ...state.groups }
        delete groups[ownerKey]
        return { groups }
      })
    },

    clearOwnerRuntimeMetadata: (ownerKey) => {
      if (ownerKey.length === 0) return
      set((state) => omitRuntimeOwners(state, [ownerKey, terminalSidePanelLayoutKey(ownerKey)]))
    },

    removeOwner: (ownerKey) => {
      if (ownerKey.length === 0) return
      set((state) => {
        const sideOwnerKey = terminalSidePanelLayoutKey(ownerKey)
        const layoutOwnerKeys = [ownerKey, sideOwnerKey]
        const groups = { ...state.groups }
        for (const layoutOwnerKey of layoutOwnerKeys) delete groups[layoutOwnerKey]
        return { groups, ...omitRuntimeOwners(state, layoutOwnerKeys) }
      })
    },

    migrateGroup: (fromOwnerKey, toOwnerKey) => {
      if (fromOwnerKey === toOwnerKey || fromOwnerKey.length === 0 || toOwnerKey.length === 0)
        return
      set((state) => {
        const source = state.groups[fromOwnerKey]
        if (source === undefined) return {}
        const groups = { ...state.groups }
        delete groups[fromOwnerKey]
        groups[toOwnerKey] = source
        const terminalIds = source.tabs.flatMap((tab) => tab.panes.map((pane) => pane.terminalId))
        return { groups, ...rekeyRuntimeState(state, fromOwnerKey, toOwnerKey, terminalIds) }
      })
    },

    rekeyRuntimeMetadata: (fromOwnerKey, toOwnerKey, terminalIds) => {
      if (fromOwnerKey === toOwnerKey || terminalIds.length === 0) return
      set((state) => rekeyRuntimeState(state, fromOwnerKey, toOwnerKey, terminalIds))
    },

    setPanelHeight: (ownerKey, height) => {
      const panelHeight = Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, Math.round(height)))
      set((state) => ({
        groups: withGroup(state.groups, ownerKey, (group) => ({ ...group, panelHeight })),
      }))
    },
  }
}

type RuntimeActions = Pick<
  TerminalState,
  'applyRuntimeEvent' | 'applyRuntimeSnapshot' | 'clearExit'
>

function createRuntimeActions(set: TerminalStateSetter): RuntimeActions {
  return {
    applyRuntimeEvent: (ownerKey, terminalId, event) => {
      const runtime = runtimeKeyOf(ownerKey, terminalId)
      if (event.type === 'activity') {
        set((state) => ({ activity: { ...state.activity, [runtime]: event.processName } }))
        return
      }
      if (event.type === 'port-previews') {
        set((state) => ({
          portPreviews: { ...state.portPreviews, [runtime]: [...event.previews] },
        }))
        return
      }
      if (event.type === 'exited') {
        set((state) => ({ exits: { ...state.exits, [runtime]: event.exitCode } }))
      }
    },

    applyRuntimeSnapshot: (summaries, truncated) => {
      set((state) => {
        const activity: Record<string, string | null> = truncated ? { ...state.activity } : {}
        const portPreviews: TerminalState['portPreviews'] = truncated
          ? { ...state.portPreviews }
          : {}
        for (const summary of summaries) {
          const runtime = runtimeKeyOf(summary.ownerKey, summary.terminalId)
          activity[runtime] = summary.processName
          portPreviews[runtime] = [...(summary.portPreviews ?? [])]
        }
        return { activity, portPreviews }
      })
    },

    clearExit: (ownerKey, terminalId) => {
      set((state) => ({ exits: omitRuntimeKeys(state, ownerKey, [terminalId]).exits }))
    },
  }
}

export function createTerminalState(
  set: TerminalStateSetter,
  get: TerminalStateGetter,
): TerminalState {
  return {
    groups: {},
    activity: {},
    portPreviews: {},
    exits: {},
    ...createLifecycleActions(set, get),
    ...createLayoutActions(set),
    ...createOwnerActions(set),
    ...createRuntimeActions(set),
  }
}
