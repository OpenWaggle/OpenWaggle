import { useNavigate } from '@tanstack/react-router'
import { refreshPreferencesAfterExtensionInvoke } from '@/features/extensions'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { EXTENSION_SIDE_PANEL_ROUTE_PANEL, useUIStore } from '@/shell/ui-store'
import {
  type ExtensionCommandActionInput,
  type ExtensionSidePanelActionInput,
  resolveExtensionCommandInvocationScope,
} from '../lib/extension-command-items'

const logger = createRendererLogger('global-command-palette')

export function useGlobalExtensionActions(input: {
  readonly projectPath: string | null
  readonly sessionId: string | null
}) {
  const navigate = useNavigate()
  const close = useUIStore((state) => state.closeCommandSurface)
  const setLastRightSidebarPanel = useUIStore((state) => state.setLastRightSidebarPanel)
  const showToast = useUIStore((state) => state.showToast)

  function invokeExtensionCommand({ entry }: ExtensionCommandActionInput) {
    if (!entry.capability || !entry.method) return
    const scope = resolveExtensionCommandInvocationScope({ entry, ...input })
    if (scope === null) return
    close()
    void api
      .invokeExtension({
        extensionId: entry.extensionId,
        contributionId: entry.contributionId,
        capability: entry.capability,
        method: entry.method,
        scope,
        payload: {},
      })
      .then(async (result) => {
        if (!result.ok) {
          showToast(result.error.message, 'error')
          return
        }
        await refreshPreferencesAfterExtensionInvoke(result)
      })
      .catch((error: unknown) => {
        logger.warn('Extension command failed', { error: String(error) })
        showToast('Extension command failed.', 'error')
      })
  }

  function openExtensionPanel({ entry }: ExtensionSidePanelActionInput) {
    const target = {
      kind: 'extension-side-panel',
      extensionId: entry.extensionId,
      sidePanelId: entry.contributionId,
      packagePath: entry.packagePath,
      contentHash: entry.contentHash,
    } as const
    close()
    setLastRightSidebarPanel(target)
    const search = {
      diff: undefined,
      panel: EXTENSION_SIDE_PANEL_ROUTE_PANEL,
      filePath: undefined,
      fileLine: undefined,
      sidePanelExtensionId: target.extensionId,
      sidePanelId: target.sidePanelId,
      sidePanelPackagePath: target.packagePath,
      sidePanelContentHash: target.contentHash,
    } as const
    if (input.sessionId) {
      void navigate({
        to: '/sessions/$sessionId',
        params: { sessionId: input.sessionId },
        search: (previous) => ({ ...previous, ...search }),
      })
      return
    }
    void navigate({ to: '/', search })
  }

  return { invokeExtensionCommand, openExtensionPanel }
}
