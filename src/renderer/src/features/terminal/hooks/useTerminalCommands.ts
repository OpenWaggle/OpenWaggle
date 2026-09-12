import { useChat } from '@/features/chat/hooks'
import { useProject } from '@/features/sessions/hooks'
import { useUIStore } from '@/shell/ui-store'
import {
  hideWorkspaceSideTerminal,
  showWorkspaceSideTerminal,
  toggleWorkspacePanelMaximized,
  useWorkspaceSideTerminalVisible,
} from '@/shell/workspace-panel-actions'
import { confirmAndCloseTerminals } from '../lib/terminal-close'
import {
  rememberTerminalLayoutFocus,
  resolveTerminalCommandLayoutOwner,
} from '../lib/terminal-focus-location'
import {
  terminalOwnerContext,
  terminalSidePanelLayoutKey,
  terminalTabTitle,
} from '../lib/terminal-owner'
import { useTerminalStore } from '../state/terminal-store'

/** Creates, reveals, and selects a terminal in the dedicated right-panel layout bucket. */
export function createSidePanelTerminal(runtimeOwnerKey: string, cwd: string | null) {
  if (runtimeOwnerKey.length === 0 || cwd === null || cwd.length === 0) return null
  const layoutOwnerKey = terminalSidePanelLayoutKey(runtimeOwnerKey)
  const store = useTerminalStore.getState()
  const terminalId = store.createTerminal(layoutOwnerKey, cwd)
  if (terminalId === null) return null
  store.setPanelOpen(layoutOwnerKey, true)
  rememberTerminalLayoutFocus(runtimeOwnerKey, layoutOwnerKey)
  showWorkspaceSideTerminal(runtimeOwnerKey)
  return terminalId
}

/**
 * Panel-level terminal actions shared by the Shortcut registry and the command
 * palette. Each action opens the terminal panel if needed and then creates or
 * splits a terminal bound to the active session's Working path (ADR 0030).
 */
export function useTerminalCommands(): {
  readonly panelOpen: boolean
  readonly toggleTerminal: () => void
  readonly closeTerminal: () => void
  readonly newTerminal: () => void
  readonly newSideTerminal: () => void
  readonly splitTerminal: () => void
  readonly splitTerminalVertical: () => void
  readonly toggleSidePanelMaximized: () => void
  readonly closeActiveTerminal: () => Promise<void>
} {
  const { activeSession } = useChat()
  const { projectPath } = useProject()
  const owner = terminalOwnerContext(activeSession ?? null, projectPath ?? null)
  const drawerOpen = useTerminalStore((state) => state.groups[owner.ownerKey]?.panelOpen ?? false)
  const sideTerminalVisible = useWorkspaceSideTerminalVisible(owner.ownerKey)
  const panelOpen = drawerOpen || sideTerminalVisible
  const showToast = useUIStore((state) => state.showToast)

  const commandLayoutOwner = () => {
    const store = useTerminalStore.getState()
    return resolveTerminalCommandLayoutOwner(owner.ownerKey, store.groups)
  }

  const revealLayout = (layoutOwnerKey: string) => {
    if (layoutOwnerKey.length === 0) return
    useTerminalStore.getState().setPanelOpen(layoutOwnerKey, true)
    if (layoutOwnerKey !== owner.ownerKey) showWorkspaceSideTerminal(owner.ownerKey)
  }

  const toggleTerminal = () => {
    if (owner.defaultCwd === null || owner.ownerKey.length === 0) return
    const store = useTerminalStore.getState()
    const sideOwnerKey = terminalSidePanelLayoutKey(owner.ownerKey)
    const layoutOwnerKey =
      drawerOpen !== sideTerminalVisible
        ? drawerOpen
          ? owner.ownerKey
          : sideOwnerKey
        : commandLayoutOwner()
    const group = store.groups[layoutOwnerKey]
    const opening = layoutOwnerKey === owner.ownerKey ? !drawerOpen : !sideTerminalVisible
    if (opening && (group?.tabs.length ?? 0) === 0) {
      store.createTerminal(layoutOwnerKey, owner.defaultCwd)
    }
    store.setPanelOpen(layoutOwnerKey, opening)
    if (layoutOwnerKey !== owner.ownerKey) {
      if (opening) showWorkspaceSideTerminal(owner.ownerKey)
      else hideWorkspaceSideTerminal(owner.ownerKey)
    }
  }

  const closeTerminal = () => {
    if (owner.ownerKey.length === 0) return
    useTerminalStore.getState().setPanelOpen(owner.ownerKey, false)
  }

  const newTerminal = () => {
    if (owner.defaultCwd === null || owner.ownerKey.length === 0) return
    const layoutOwnerKey = commandLayoutOwner()
    revealLayout(layoutOwnerKey)
    useTerminalStore.getState().createTerminal(layoutOwnerKey, owner.defaultCwd)
  }

  const newSideTerminal = () => {
    createSidePanelTerminal(owner.ownerKey, owner.defaultCwd)
  }

  const toggleSidePanelMaximized = () => {
    if (toggleWorkspacePanelMaximized(owner.ownerKey)) return
    showToast('Open the workspace side panel first.', 'error')
  }

  const splitTerminalInDirection = (direction: 'side-by-side' | 'stacked') => {
    if (owner.defaultCwd === null || owner.ownerKey.length === 0) return
    const store = useTerminalStore.getState()
    const layoutOwnerKey = commandLayoutOwner()
    revealLayout(layoutOwnerKey)
    const group = store.groups[layoutOwnerKey]
    const activeTabId = group?.activeTabId ?? group?.tabs[group.tabs.length - 1]?.id ?? null
    if (activeTabId === null) {
      store.createTerminal(layoutOwnerKey, owner.defaultCwd)
      return
    }
    store.setSplitDirection(layoutOwnerKey, activeTabId, direction)
    store.splitTerminal(layoutOwnerKey, activeTabId, owner.defaultCwd)
  }

  const closeActiveTerminal = async () => {
    if (owner.ownerKey.length === 0) return
    const store = useTerminalStore.getState()
    const layoutOwnerKey = commandLayoutOwner()
    const group = store.groups[layoutOwnerKey]
    const tab = group?.tabs.find((candidate) => candidate.id === group.activeTabId)
    const terminalId = tab?.activePaneId
    if (group === undefined || tab === undefined || terminalId === undefined) return
    const paneIndex = tab.panes.findIndex((pane) => pane.terminalId === terminalId)
    const tabIndex = group.tabs.indexOf(tab)
    const tabTitle = terminalTabTitle(owner.ownerKey, tab, tabIndex, store.activity, terminalId)
    const label = tab.panes.length === 1 ? tabTitle : `${tabTitle} pane ${paneIndex + 1}`
    try {
      const result = await confirmAndCloseTerminals(owner.ownerKey, [{ terminalId, label }])
      if (result === 'closed') store.closePane(layoutOwnerKey, terminalId)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Terminal could not be closed.', 'error')
    }
  }

  return {
    panelOpen,
    toggleTerminal,
    closeTerminal,
    newTerminal,
    newSideTerminal,
    splitTerminal: () => splitTerminalInDirection('side-by-side'),
    splitTerminalVertical: () => splitTerminalInDirection('stacked'),
    toggleSidePanelMaximized,
    closeActiveTerminal,
  }
}
