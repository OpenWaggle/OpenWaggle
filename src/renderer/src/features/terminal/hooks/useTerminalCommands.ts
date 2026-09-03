import { useChat } from '@/features/chat/hooks'
import { useProject } from '@/features/sessions/hooks'
import { useUIStore } from '@/shell/ui-store'
import { terminalOwnerContext } from '../lib/terminal-owner'
import { useTerminalStore } from '../state/terminal-store'

/**
 * Panel-level terminal actions shared by the Shortcut registry and the command
 * palette. Each action opens the terminal panel if needed and then creates or
 * splits a terminal bound to the active session's Working path (ADR 0030).
 */
export function useTerminalCommands(): {
  readonly newTerminal: () => void
  readonly splitTerminal: () => void
} {
  const { activeSession } = useChat()
  const { projectPath } = useProject()

  const openPanelIfNeeded = () => {
    const ui = useUIStore.getState()
    if (!ui.terminalOpen) ui.toggleTerminal()
  }

  const newTerminal = () => {
    const owner = terminalOwnerContext(activeSession, projectPath)
    if (owner.defaultCwd === null || owner.ownerKey.length === 0) return
    openPanelIfNeeded()
    useTerminalStore.getState().createTerminal(owner.ownerKey, owner.defaultCwd)
  }

  const splitTerminal = () => {
    const owner = terminalOwnerContext(activeSession, projectPath)
    if (owner.defaultCwd === null || owner.ownerKey.length === 0) return
    openPanelIfNeeded()
    const store = useTerminalStore.getState()
    const group = store.groups[owner.ownerKey]
    const activeTabId = group?.activeTabId ?? group?.tabs[group.tabs.length - 1]?.id ?? null
    if (activeTabId === null) {
      store.createTerminal(owner.ownerKey, owner.defaultCwd)
      return
    }
    store.splitTerminal(owner.ownerKey, activeTabId, owner.defaultCwd)
  }

  return { newTerminal, splitTerminal }
}
