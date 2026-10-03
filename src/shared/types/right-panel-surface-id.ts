/**
 * Stable identities of extension-contributed Right panel surfaces (ADR 0043).
 *
 * Shared by the renderer (rail, palette, shortcuts) and the main process (settings validation),
 * so a persisted extension panel shortcut keeps pointing at the same panel across extension
 * updates, uninstalls and reinstalls. The id never contains a package path or content hash.
 */

const EXTENSION_SURFACE_PREFIX = 'extension:'
/** The encoded id is a JSON pair: extension id, then side panel id. */
const EXTENSION_SURFACE_ID_PARTS = 2

/** Upper bound for one persisted extension surface id. */
export const EXTENSION_RIGHT_PANEL_SURFACE_ID_MAX_LENGTH = 1024

export type ExtensionRightPanelSurfaceId = `extension:${string}`

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

export function parseExtensionRightPanelSurfaceId(id: string): ExtensionSidePanelIdentity | null {
  if (!id.startsWith(EXTENSION_SURFACE_PREFIX)) return null
  try {
    const parsed: unknown = JSON.parse(id.slice(EXTENSION_SURFACE_PREFIX.length))
    if (
      !Array.isArray(parsed) ||
      parsed.length !== EXTENSION_SURFACE_ID_PARTS ||
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

/** True only for the canonical encoding, so one panel cannot be stored under two keys. */
export function isExtensionRightPanelSurfaceId(id: string): id is ExtensionRightPanelSurfaceId {
  if (id.length > EXTENSION_RIGHT_PANEL_SURFACE_ID_MAX_LENGTH) return false
  const identity = parseExtensionRightPanelSurfaceId(id)
  return identity !== null && extensionRightPanelSurfaceId(identity) === id
}
