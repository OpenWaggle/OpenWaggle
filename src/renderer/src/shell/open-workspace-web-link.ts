import {
  clearBrowserPreviewExternalFallback,
  normalizeBrowserPreviewUrl,
  registerBrowserPreviewExternalFallback,
} from '@/features/browser-preview'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { openWorkspacePreviewWithResult } from './workspace-panel-actions'
import { useWorkspacePanelStore } from './workspace-panel-store'

let settingsLoad: Promise<void> | null = null

async function ensureSettingsLoaded() {
  const preferences = usePreferencesStore.getState()
  if (preferences.isLoaded) return
  settingsLoad ??= preferences.loadSettings().finally(() => {
    settingsLoad = null
  })
  await settingsLoad
}

/** Routes a validated Session web link through the user's persisted destination. */
export async function openWorkspaceWebLink(ownerKey: string, rawUrl: string): Promise<void> {
  const url = normalizeBrowserPreviewUrl(rawUrl)
  if (url === null) throw new Error('Only http and https links can be opened.')
  await ensureSettingsLoaded()
  const settings = usePreferencesStore.getState().settings
  const target = settings.browserLinkTarget
  if (target === 'system' || ownerKey.length === 0) {
    await api.openExternal(url)
    return
  }

  const { previewId } = openWorkspacePreviewWithResult(
    ownerKey,
    url,
    settings.browserDefaultProfileId,
  )
  const tab = useWorkspacePanelStore
    .getState()
    .groups[ownerKey]?.browserTabs.find((candidate) => candidate.id === previewId)
  if (tab === undefined || tab.error !== null) {
    clearBrowserPreviewExternalFallback(previewId)
    await api.openExternal(url)
    return
  }
  if (tab?.loading === true) registerBrowserPreviewExternalFallback(previewId, url)
}
