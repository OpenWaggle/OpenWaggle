import type { Settings } from '@shared/types/settings'
import { builtInRightPanelSurface } from '@/shared/lib/right-panel-catalog'
import {
  isBuiltInRightPanelSurfaceId,
  type RightPanelSurfaceId,
} from '@/shared/lib/right-panel-surfaces'
import { formatShortcutBinding } from '@/shared/lib/shortcut-display'
import type { ShortcutBinding } from '@shared/types/shortcuts'

export interface RightPanelSurfaceShortcut {
  readonly binding: ShortcutBinding | null
  /** Platform display of the binding, or null when the surface is unassigned. */
  readonly label: string | null
}

type ShortcutSettings = Pick<Settings, 'shortcutBindings' | 'extensionPanelShortcutBindings'>

/** The binding that toggles a Right panel surface: its Shortcut registry command or user binding. */
export function rightPanelSurfaceShortcut(settings: ShortcutSettings, id: RightPanelSurfaceId) {
  const binding = isBuiltInRightPanelSurfaceId(id)
    ? settings.shortcutBindings[builtInRightPanelSurface(id).command]
    : (settings.extensionPanelShortcutBindings[id] ?? null)
  const shortcut: RightPanelSurfaceShortcut = {
    binding,
    label: binding === null ? null : formatShortcutBinding(binding),
  }
  return shortcut
}
