/**
 * Stable identities and the command entry points for Right panel surfaces (ADR 0043).
 *
 * Features ask for a surface by id; the shell-owned Right panel controller registers the
 * implementation. Keeping the entry points here lets shortcuts, the command palette and
 * feature surfaces open panels without importing shell internals.
 */

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

const EXTENSION_SURFACE_PREFIX = 'extension:'

export type ExtensionRightPanelSurfaceId = `extension:${string}`

export type RightPanelSurfaceId = BuiltInRightPanelSurfaceId | ExtensionRightPanelSurfaceId

export interface ExtensionSidePanelIdentity {
  readonly extensionId: string
  readonly sidePanelId: string
}

/** The rail identity of an extension side panel, stable across extension updates. */
export function extensionRightPanelSurfaceId(
  identity: ExtensionSidePanelIdentity,
): ExtensionRightPanelSurfaceId {
  return `${EXTENSION_SURFACE_PREFIX}${JSON.stringify([identity.extensionId, identity.sidePanelId])}`
}

export function parseExtensionRightPanelSurfaceId(
  id: string,
): ExtensionSidePanelIdentity | null {
  if (!id.startsWith(EXTENSION_SURFACE_PREFIX)) return null
  try {
    const parsed: unknown = JSON.parse(id.slice(EXTENSION_SURFACE_PREFIX.length))
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string' ||
      parsed[0].length === 0 ||
      parsed[1].length === 0
    ) {
      return null
    }
    return { extensionId: parsed[0], sidePanelId: parsed[1] }
  } catch {
    return null
  }
}

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
}

let controller: RightPanelController | null = null

/** The shell registers the live controller while a chat route is mounted. */
export function registerRightPanelController(next: RightPanelController) {
  controller = next
  return () => {
    if (controller === next) controller = null
  }
}

export function toggleRightPanelSurface(id: RightPanelSurfaceId) {
  controller?.toggleSurface(id)
}

export function showRightPanelSurface(id: RightPanelSurfaceId) {
  controller?.showSurface(id)
}
