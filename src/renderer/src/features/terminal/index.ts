// Terminal panes, panels, and search stay out of this root index: the eager shell imports it for
// hooks and helpers, and re-exporting xterm-backed components here pulls them into the initial
// renderer graph. Load them lazily from `@/features/terminal/components`.
export { useTerminalActivityMonitor } from './hooks/useTerminalActivityMonitor'
export { createSidePanelTerminal, useTerminalCommands } from './hooks/useTerminalCommands'
export {
  openActionOutputTerminalView,
  syncActionOutputViewRuns,
} from './lib/open-action-output-terminal-view'
export {
  runSessionTerminalCommand,
  watchSessionTerminalCommand,
} from './lib/run-session-terminal-command'
export { reconcileSetupActionTerminal } from './lib/setup-action-terminal'
export { beginTerminalEventOwnerHandoff } from './lib/terminal-event-owner-alias'
export {
  migrateTerminalLayoutFocus,
  rememberTerminalLayoutFocus,
  resolveTerminalCommandLayoutOwner,
} from './lib/terminal-focus-location'
export { terminalInputDispatcher } from './lib/terminal-input-dispatcher'
export {
  runtimeKeyOf,
  type TerminalOwnerContext,
  terminalOwnerContext,
  terminalSidePanelLayoutKey,
} from './lib/terminal-owner'
export { matchesTerminalShortcutBinding } from './lib/terminal-shortcuts'
export { migrateTerminalSurfaceLeases } from './lib/terminal-surface-lease'
export {
  useRunningTerminalCount,
  useRunningTerminalCounts,
  useTerminalActivityStore,
} from './state/terminal-activity-store'
export { type TerminalGroupState, useTerminalStore } from './state/terminal-store'
export {
  MAX_PANEL_HEIGHT,
  MIN_PANEL_HEIGHT,
  TERMINAL_PANEL_DEFAULT_HEIGHT,
} from './state/terminal-store-persistence'
