import { isExtensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import {
  EXTENSION_PANEL_SHORTCUT_LIMITS,
  type ExtensionPanelShortcutBindings,
  type ShortcutBinding,
} from '@shared/types/shortcuts'
import { isObjectRecord, sanitizeShortcutBinding } from './sanitizers'

/**
 * Keeps well-formed extension panel bindings keyed by their canonical surface id. Bindings for
 * panels whose extension is not installed are kept on purpose: a reinstall gets them back.
 */
export function sanitizeExtensionPanelShortcutBindings(
  raw: unknown,
): ExtensionPanelShortcutBindings {
  if (!isObjectRecord(raw)) return {}
  const result: Record<string, ShortcutBinding> = {}
  for (const [surfaceId, value] of Object.entries(raw)) {
    if (Object.keys(result).length >= EXTENSION_PANEL_SHORTCUT_LIMITS.BINDINGS) break
    if (!isExtensionRightPanelSurfaceId(surfaceId)) continue
    const binding = sanitizeShortcutBinding(value)
    if (binding !== null) result[surfaceId] = binding
  }
  return result
}
