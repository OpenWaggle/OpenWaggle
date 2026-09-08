export { TerminalPane, TerminalPanel, TerminalSearchBar } from './components'
export { useTerminalActivityMonitor } from './hooks/useTerminalActivityMonitor'
export { createSidePanelTerminal, useTerminalCommands } from './hooks/useTerminalCommands'
export { reconcileSetupActionTerminal } from './lib/setup-action-terminal'
export { beginTerminalEventOwnerHandoff } from './lib/terminal-event-owner-alias'
export {
  migrateTerminalLayoutFocus,
  rememberTerminalLayoutFocus,
  resolveTerminalCommandLayoutOwner,
} from './lib/terminal-focus-location'
export {
  type TerminalInputEnqueueResult,
  type TerminalProjectActionEnqueueResult,
  terminalInputDispatcher,
} from './lib/terminal-input-dispatcher'
export {
  sameTerminalLaunchEnvironment,
  type TerminalLaunchEnvironment,
} from './lib/terminal-launch-environment'
export {
  runtimeKeyOf,
  type TerminalOwnerContext,
  terminalOwnerContext,
  terminalSidePanelLayoutKey,
  terminalTabTitle,
} from './lib/terminal-owner'
export { matchesTerminalShortcutBinding } from './lib/terminal-shortcuts'
export { migrateTerminalSurfaceLeases } from './lib/terminal-surface-lease'
export {
  getRunningTerminalCount,
  getTerminalActivityStatus,
  getTerminalProjectActionPending,
  useRunningTerminalCount,
  useRunningTerminalCounts,
  useTerminalActivityStore,
} from './state/terminal-activity-store'
export {
  type TerminalGroupState,
  type TerminalPaneState,
  type TerminalSplitDirection,
  type TerminalTabState,
  useTerminalStore,
} from './state/terminal-store'
export {
  MAX_PANEL_HEIGHT,
  MIN_PANEL_HEIGHT,
  TERMINAL_PANEL_DEFAULT_HEIGHT,
} from './state/terminal-store-persistence'
