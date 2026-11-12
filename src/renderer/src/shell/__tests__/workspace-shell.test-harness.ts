import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useTerminalStore } from '@/features/terminal'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { installMatchMedia } from '@/shared/ui/__tests__/right-sidebar-layout.test-harness'
import { useUIStore } from '../ui-store'
import { useWorkspacePanelStore } from '../workspace-panel-store'

/** The owner the shell shows for a draft in `/repo`, which `resetWorkspaceShellStores` opens. */
export const DRAFT_OWNER = 'draft:/repo'

/**
 * Puts every store the workspace shell reads back to a draft in `projectPath`, with no Session,
 * terminal, panel or toast. Workers are reused across files, so call it before and after each
 * case. The window is wide: the Right panel docks instead of opening as a sheet.
 */
export function resetWorkspaceShellStores(projectPath = '/repo') {
  usePreferencesStore.setState(
    {
      ...usePreferencesStore.getInitialState(),
      settings: { ...DEFAULT_SETTINGS, projectPath },
      isLoaded: true,
    },
    true,
  )
  useChatStore.setState(useChatStore.getInitialState(), true)
  useSessionStore.setState(useSessionStore.getInitialState(), true)
  useTerminalStore.setState({ groups: {}, activity: {}, portPreviews: {}, exits: {} })
  useWorkspacePanelStore.setState({ groups: {} })
  useRightSidebarCoordinator.setState({ activeClaim: null })
  useUIStore.setState({
    ...useUIStore.getInitialState(),
    feedbackModalOpen: false,
    toastMessage: null,
    toastData: null,
  })
  vi.unstubAllGlobals()
  installMatchMedia(false)
}
