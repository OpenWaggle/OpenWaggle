import {
  deferWorkspaceOwnerReconciliation,
  isWorkspaceOwnerHandoffPending,
  WORKSPACE_OWNER_HANDOFF_MESSAGE,
} from '@/shared/lib/workspace-owner-handoff'
import { useUIStore } from '@/shell/ui-store'
import {
  closePaneAction,
  createTerminalAction,
  ensureTerminalAction,
  splitTerminalAction,
  transferTabs,
  withGroup,
} from './terminal-store-layout'
import { omitRuntimeKeys } from './terminal-store-runtime'
import type {
  TerminalState,
  TerminalStateGetter,
  TerminalStateSetter,
} from './terminal-store-types'

type LifecycleActions = Pick<
  TerminalState,
  | 'createTerminal'
  | 'ensureTerminal'
  | 'splitTerminal'
  | 'closePane'
  | 'closeTab'
  | 'moveTab'
  | 'moveAllTabs'
>

function ownersAvailableForMutation(...owners: readonly string[]) {
  if (!owners.some(isWorkspaceOwnerHandoffPending)) return true
  useUIStore.getState().showToast(WORKSPACE_OWNER_HANDOFF_MESSAGE, 'neutral')
  return false
}

export function createLifecycleActions(
  set: TerminalStateSetter,
  get: TerminalStateGetter,
): LifecycleActions {
  return {
    createTerminal: (ownerKey, cwd, launchEnv) =>
      !ownersAvailableForMutation(ownerKey)
        ? null
        : createTerminalAction(set, ownerKey, cwd, launchEnv),

    ensureTerminal: (ownerKey, terminalId, cwd, options) => {
      const reconcile = (resolvedOwner: string) => {
        try {
          ensureTerminalAction(set, resolvedOwner, terminalId, cwd, options)
        } catch (error) {
          useUIStore
            .getState()
            .showToast(
              error instanceof Error ? error.message : 'Setup terminal could not be restored.',
              'error',
            )
        }
      }
      if (!deferWorkspaceOwnerReconciliation(ownerKey, terminalId, reconcile)) reconcile(ownerKey)
    },

    splitTerminal: (ownerKey, tabId, cwd, launchEnv) =>
      !ownersAvailableForMutation(ownerKey)
        ? null
        : splitTerminalAction(get, set, ownerKey, tabId, cwd, launchEnv),

    closePane: (ownerKey, terminalId) => closePaneAction(set, ownerKey, terminalId),

    closeTab: (ownerKey, tabId) => {
      const target = get().groups[ownerKey]?.tabs.find((tab) => tab.id === tabId)
      if (target === undefined) return []
      const closedIds = target.panes.map((pane) => pane.terminalId)
      set((state) => {
        const group = state.groups[ownerKey]
        if (group === undefined) return {}
        const closingIndex = group.tabs.findIndex((tab) => tab.id === tabId)
        const tabs = group.tabs.filter((tab) => tab.id !== tabId)
        const activeTabId =
          group.activeTabId === tabId
            ? (tabs[Math.min(closingIndex, tabs.length - 1)]?.id ?? null)
            : group.activeTabId
        return {
          groups: withGroup(state.groups, ownerKey, () => ({ ...group, tabs, activeTabId })),
          ...omitRuntimeKeys(state, ownerKey, closedIds),
        }
      })
      return closedIds
    },

    moveTab: (fromOwnerKey, toOwnerKey, tabId) => {
      if (!ownersAvailableForMutation(fromOwnerKey, toOwnerKey)) return
      set((state) => ({
        groups: transferTabs(state.groups, fromOwnerKey, toOwnerKey, new Set([tabId])),
      }))
    },

    moveAllTabs: (fromOwnerKey, toOwnerKey) => {
      if (!ownersAvailableForMutation(fromOwnerKey, toOwnerKey)) return
      set((state) => {
        const source = state.groups[fromOwnerKey]
        if (source === undefined) return {}
        return {
          groups: transferTabs(
            state.groups,
            fromOwnerKey,
            toOwnerKey,
            new Set(source.tabs.map((tab) => tab.id)),
          ),
        }
      })
    },
  }
}
