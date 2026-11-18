import { decodeUnknownOrThrow } from '@shared/schema'
import { lenientRecord } from '@shared/schemas/lenient'
import { isExtensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import {
  EXTENSION_PANEL_SHORTCUT_LIMITS,
  type ExtensionPanelShortcutBindings,
} from '@shared/types/shortcuts'
import { storedShortcutBindingSchema } from './sanitizers'

/** The stored bindings that decode; a malformed one is dropped, not the whole record. */
const storedExtensionPanelShortcutBindingsSchema = lenientRecord(storedShortcutBindingSchema)

/**
 * Keeps well-formed extension panel bindings keyed by their canonical surface id. Bindings for
 * panels whose extension is not installed are kept on purpose: a reinstall gets them back.
 */
export function sanitizeExtensionPanelShortcutBindings(raw: unknown) {
  const bindings = decodeUnknownOrThrow(storedExtensionPanelShortcutBindingsSchema, raw)
  const result: ExtensionPanelShortcutBindings = Object.fromEntries(
    Object.entries(bindings)
      .filter(([surfaceId]) => isExtensionRightPanelSurfaceId(surfaceId))
      .slice(0, EXTENSION_PANEL_SHORTCUT_LIMITS.BINDINGS),
  )
  return result
}
