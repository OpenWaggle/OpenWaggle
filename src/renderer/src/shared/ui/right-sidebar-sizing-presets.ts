import type { RightSidebarSizing } from './right-sidebar-layout-types'

/**
 * The sizing every workspace-level right sidebar shares, so the terminal/browser panel and the
 * guided action panel resize and become sheets identically (ADR 0038).
 */
export const WORKSPACE_SIDE_PANEL_SIZING = {
  defaultWidth: 520,
  minWidth: 320,
  maxWidth: 900,
  mainMinWidth: 420,
  sheetBreakpointPx: 980,
} as const satisfies Omit<RightSidebarSizing, 'storageKey'>
