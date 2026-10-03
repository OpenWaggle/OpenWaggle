import type { RightSidebarSizing } from './right-sidebar-layout-types'

/** The one width every Right panel surface shares and remembers (ADR 0043). */
export const RIGHT_PANEL_WIDTH_STORAGE_KEY = 'openwaggle:right-panel-width'

/** Widths saved before ADR 0043 merged the right sidebars, read once when no shared width exists. */
export const LEGACY_RIGHT_PANEL_WIDTH_STORAGE_KEYS = [
  'openwaggle:diff-sidebar-width',
  'openwaggle:workspace-side-panel-width',
  'openwaggle:action-panel-width',
] as const

/**
 * The sizing every right sidebar shares: route panels, the workspace panel and the guided action
 * panel resize together and become sheets at the same width (ADR 0038, ADR 0043).
 */
export const WORKSPACE_SIDE_PANEL_SIZING = {
  defaultWidth: 560,
  minWidth: 360,
  maxWidth: 900,
  mainMinWidth: 420,
  sheetBreakpointPx: 1180,
} as const satisfies Omit<RightSidebarSizing, 'storageKey'>

export const RIGHT_PANEL_SIZING = {
  ...WORKSPACE_SIDE_PANEL_SIZING,
  storageKey: RIGHT_PANEL_WIDTH_STORAGE_KEY,
} as const satisfies RightSidebarSizing
