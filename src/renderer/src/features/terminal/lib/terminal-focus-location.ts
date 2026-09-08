import type { TerminalGroupState } from '../state/terminal-store'
import { terminalSidePanelLayoutKey } from './terminal-owner'

const focusedLayoutByRuntimeOwner = new Map<string, string>()
const MAX_REMEMBERED_TERMINAL_FOCUS_OWNERS = 128

function pruneOldestRememberedFocus() {
  while (focusedLayoutByRuntimeOwner.size > MAX_REMEMBERED_TERMINAL_FOCUS_OWNERS) {
    const oldestOwner = focusedLayoutByRuntimeOwner.keys().next().value
    if (oldestOwner === undefined) return
    focusedLayoutByRuntimeOwner.delete(oldestOwner)
  }
}

export function rememberTerminalLayoutFocus(runtimeOwnerKey: string, layoutOwnerKey: string) {
  if (runtimeOwnerKey.length > 0 && layoutOwnerKey.length > 0) {
    focusedLayoutByRuntimeOwner.delete(runtimeOwnerKey)
    focusedLayoutByRuntimeOwner.set(runtimeOwnerKey, layoutOwnerKey)
    pruneOldestRememberedFocus()
  }
}

export function migrateTerminalLayoutFocus(fromOwnerKey: string, toOwnerKey: string) {
  const focusedLayout = focusedLayoutByRuntimeOwner.get(fromOwnerKey)
  if (focusedLayout === undefined) return
  focusedLayoutByRuntimeOwner.delete(fromOwnerKey)
  rememberTerminalLayoutFocus(
    toOwnerKey,
    focusedLayout === terminalSidePanelLayoutKey(fromOwnerKey)
      ? terminalSidePanelLayoutKey(toOwnerKey)
      : toOwnerKey,
  )
}

function hasTabs(group: TerminalGroupState | undefined) {
  return (group?.tabs.length ?? 0) > 0
}

/** Focus wins; otherwise prefer a visible drawer, then an existing side group, then the drawer. */
export function resolveTerminalCommandLayoutOwner(
  runtimeOwnerKey: string,
  groups: Readonly<Record<string, TerminalGroupState>>,
) {
  const sideOwnerKey = terminalSidePanelLayoutKey(runtimeOwnerKey)
  const remembered = focusedLayoutByRuntimeOwner.get(runtimeOwnerKey)
  if (remembered !== undefined && hasTabs(groups[remembered])) return remembered
  if (remembered !== undefined) focusedLayoutByRuntimeOwner.delete(runtimeOwnerKey)
  const base = groups[runtimeOwnerKey]
  const side = groups[sideOwnerKey]
  if (base?.panelOpen === true && hasTabs(base)) return runtimeOwnerKey
  if (side?.panelOpen === true && hasTabs(side)) return sideOwnerKey
  if (hasTabs(base)) return runtimeOwnerKey
  if (hasTabs(side)) return sideOwnerKey
  return runtimeOwnerKey
}

export function resetTerminalLayoutFocusForTests() {
  focusedLayoutByRuntimeOwner.clear()
}
