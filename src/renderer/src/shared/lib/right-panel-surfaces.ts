/**
 * Stable identities and the command entry points for Right panel surfaces (ADR 0043).
 *
 * Features ask for a surface by id; the shell-owned Right panel controller registers the
 * implementation. Keeping the entry points here lets shortcuts, the command palette and
 * feature surfaces open panels without importing shell internals.
 */

import {
  type ExtensionRightPanelSurfaceId,
  parseExtensionRightPanelSurfaceId,
} from '@shared/types/right-panel-surface-id'

export const BUILT_IN_RIGHT_PANEL_SURFACE_IDS = [
  'all-panels',
  'changes',
  'project-actions',
  'browser',
  'files',
  'session-tree',
  'resources',
] as const

export type BuiltInRightPanelSurfaceId = (typeof BUILT_IN_RIGHT_PANEL_SURFACE_IDS)[number]

export {
  type ExtensionRightPanelSurfaceId,
  type ExtensionSidePanelIdentity,
  extensionRightPanelSurfaceId,
  isExtensionRightPanelSurfaceId,
  parseExtensionRightPanelSurfaceId,
} from '@shared/types/right-panel-surface-id'

export type RightPanelSurfaceId = BuiltInRightPanelSurfaceId | ExtensionRightPanelSurfaceId

export function isBuiltInRightPanelSurfaceId(id: string): id is BuiltInRightPanelSurfaceId {
  return BUILT_IN_RIGHT_PANEL_SURFACE_IDS.some((surfaceId) => surfaceId === id)
}

export function isRightPanelSurfaceId(id: string): id is RightPanelSurfaceId {
  return isBuiltInRightPanelSurfaceId(id) || parseExtensionRightPanelSurfaceId(id) !== null
}

export interface RightPanelController {
  /** Shows the surface, or closes the Right panel when that surface is already shown. */
  readonly toggleSurface: (id: RightPanelSurfaceId) => void
  /** Shows the surface and never closes the Right panel. */
  readonly showSurface: (id: RightPanelSurfaceId) => void
  /** Shows the Right panel on its remembered surface, or closes it when open. */
  readonly togglePanel: () => void
  readonly closePanel: () => void
}

let controller: RightPanelController | null = null

/** The shell registers the live controller while a chat route is mounted. */
export function registerRightPanelController(next: RightPanelController) {
  controller = next
  return () => {
    if (controller === next) controller = null
  }
}

/** False until the shell registers a controller, so callers can keep a legacy fallback. */
export function hasRightPanelController() {
  return controller !== null
}

export function toggleRightPanelSurface(id: RightPanelSurfaceId) {
  controller?.toggleSurface(id)
}

export function showRightPanelSurface(id: RightPanelSurfaceId) {
  controller?.showSurface(id)
}

export function toggleRightPanel() {
  controller?.togglePanel()
}

export function closeRightPanel() {
  controller?.closePanel()
}
