import type { RightPanelSurfaceId } from '@/shared/lib/right-panel-surfaces'
import {
  type RightPanelSurfaceShortcut,
  rightPanelSurfaceShortcut,
} from '../lib/right-panel-surface-shortcuts'
import { usePreferencesStore } from '../state'

/** Current binding and display label of the shortcut that toggles one Right panel surface. */
export function useRightPanelSurfaceShortcut(id: RightPanelSurfaceId): RightPanelSurfaceShortcut {
  const shortcutBindings = usePreferencesStore((state) => state.settings.shortcutBindings)
  const extensionPanelShortcutBindings = usePreferencesStore(
    (state) => state.settings.extensionPanelShortcutBindings,
  )
  return rightPanelSurfaceShortcut({ shortcutBindings, extensionPanelShortcutBindings }, id)
}
