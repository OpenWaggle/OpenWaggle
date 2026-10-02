import { useEffect } from 'react'
import { useChat } from '@/features/chat/hooks'
import { useProject } from '@/features/sessions/hooks'
import { usePreferencesStore } from '@/features/settings/state'
import { terminalOwnerContext } from '@/features/terminal'
import { useMediaQuery } from '@/shared/hooks/useMediaQuery'
import { useRightPanelMaximizeStore } from '@/shared/lib/right-panel-maximize'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { formatShortcutBinding } from '@/shared/lib/shortcut-display'
import { RIGHT_PANEL_SIZING } from '@/shared/ui/right-sidebar-sizing-presets'
import { toggleWorkspacePanelMaximized } from '../workspace-panel-actions'
import { useWorkspacePanelStore } from '../workspace-panel-store'

const SHEET_QUERY = `(max-width: ${String(RIGHT_PANEL_SIZING.sheetBreakpointPx)}px)`

/**
 * Publishes the Session's maximize state for every Right panel surface header (ADR 0043). Mounted
 * on every page, so a surface shown off a chat page can still be restored. A narrow-window sheet
 * and the guided action panel keep their own width, so they offer no maximize control.
 */
export function RightPanelMaximizePublisher() {
  const { activeSession } = useChat()
  const { projectPath } = useProject()
  const { ownerKey } = terminalOwnerContext(activeSession ?? null, projectPath ?? null)
  const maximized = useWorkspacePanelStore((state) => state.groups[ownerKey]?.maximized === true)
  const guided = useRightSidebarCoordinator((state) => state.activeClaim?.kind === 'action-panel')
  const isSheet = useMediaQuery(SHEET_QUERY)
  const binding = usePreferencesStore(
    (state) => state.settings.shortcutBindings['rightPanel.toggleMaximized'] ?? null,
  )
  const shortcutLabel = binding === null ? null : formatShortcutBinding(binding)
  const canMaximize = ownerKey.length > 0 && !isSheet && !guided

  useEffect(() => {
    const store = useRightPanelMaximizeStore.getState()
    store.publish({
      maximized,
      canMaximize,
      shortcutLabel,
      toggle: () => {
        toggleWorkspacePanelMaximized(ownerKey)
      },
    })
    return () => store.publish(null)
  }, [canMaximize, maximized, ownerKey, shortcutLabel])
  return null
}
