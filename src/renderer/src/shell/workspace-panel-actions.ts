import {
  clearBrowserPreviewExternalFallback,
  normalizeBrowserPreviewUrl,
  useBrowserPreviewFloatingStore,
} from '@/features/browser-preview'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { useWorkspacePanelStore } from './workspace-panel-store'

function activeBrowserPreviewId(ownerKey: string) {
  const group = useWorkspacePanelStore.getState().groups[ownerKey]
  if (group === undefined) return null
  const selectedId =
    group.activeSurface?.kind === 'browser'
      ? group.activeSurface.previewId
      : (group.browserTabs.at(-1)?.id ?? null)
  return (
    group.browserTabs.find((tab) => tab.id === selectedId && tab.kind === 'preview')?.id ?? null
  )
}

function activeBrowserTabId(ownerKey: string) {
  const group = useWorkspacePanelStore.getState().groups[ownerKey]
  if (group === undefined) return null
  if (group.activeSurface?.kind === 'browser') return group.activeSurface.previewId
  return group.browserTabs.at(-1)?.id ?? null
}

function disposeEvictedPreview(ownerKey: string, previewId: string | null) {
  if (previewId === null) return
  useBrowserPreviewFloatingStore.getState().removePreview(ownerKey, previewId)
  clearBrowserPreviewExternalFallback(previewId)
  void api.closeBrowserPreview(previewId).catch(() => undefined)
}

/** Opens a trusted project preview in-app, independent of the general link preference. */
export function openWorkspacePreviewWithResult(
  ownerKey: string,
  rawUrl: string,
  profileId = usePreferencesStore.getState().settings.browserDefaultProfileId,
) {
  const url = normalizeBrowserPreviewUrl(rawUrl)
  if (url === null) throw new Error('Only http and https links can be previewed.')
  if (ownerKey.length === 0) throw new Error('Open a project before showing a preview.')
  const { previewId, evictedPreviewId } = useWorkspacePanelStore
    .getState()
    .openBrowser(ownerKey, url, profileId)
  disposeEvictedPreview(ownerKey, evictedPreviewId)
  return { previewId, evictedPreviewId }
}

export function openWorkspacePreview(ownerKey: string, rawUrl: string): void {
  openWorkspacePreviewWithResult(ownerKey, rawUrl)
}

/** Creates an independent empty browser tab, even when an identical preview is already open. */
export function newWorkspaceBrowser(ownerKey: string) {
  if (ownerKey.length === 0) return false
  const profileId = usePreferencesStore.getState().settings.browserDefaultProfileId
  const { evictedPreviewId } = useWorkspacePanelStore.getState().newBrowser(ownerKey, profileId)
  disposeEvictedPreview(ownerKey, evictedPreviewId)
  return true
}

export function showWorkspaceSideTerminal(ownerKey: string) {
  useWorkspacePanelStore.getState().showTerminal(ownerKey)
}

export function hideWorkspaceSideTerminal(ownerKey: string) {
  useWorkspacePanelStore.getState().hideTerminal(ownerKey)
}

/** Toggles the retained workspace panel without opening a surface implicitly. */
export function toggleWorkspacePanelMaximized(ownerKey: string) {
  const store = useWorkspacePanelStore.getState()
  const group = store.groups[ownerKey]
  if (ownerKey.length === 0 || group?.panelOpen !== true || group.activeSurface === null) {
    return false
  }
  store.setMaximized(ownerKey, !group.maximized)
  return true
}

/** Toggles the retained panel and preserves whichever surface was selected last. */
export function toggleWorkspaceRightPanel(ownerKey: string) {
  const store = useWorkspacePanelStore.getState()
  const group = store.groups[ownerKey]
  if (ownerKey.length === 0 || group === undefined || group.activeSurface === null) return false
  if (group.panelOpen) {
    store.hidePanel(ownerKey)
    return true
  }
  if (group.activeSurface.kind === 'terminal') store.showTerminal(ownerKey)
  else store.showBrowser(ownerKey, group.activeSurface.previewId)
  return true
}

export function closeWorkspaceRightPanel(ownerKey: string) {
  useWorkspacePanelStore.getState().hidePanel(ownerKey)
}

export function hasActiveWorkspaceRightPanel(ownerKey: string) {
  const group = useWorkspacePanelStore.getState().groups[ownerKey]
  return group?.panelOpen === true && group.activeSurface !== null
}

export function toggleWorkspacePreview(ownerKey: string) {
  const store = useWorkspacePanelStore.getState()
  const group = store.groups[ownerKey]
  const previewId = activeBrowserTabId(ownerKey)
  if (previewId === null) return newWorkspaceBrowser(ownerKey)
  if (group.panelOpen && group.activeSurface?.kind === 'browser') store.hidePanel(ownerKey)
  else store.showBrowser(ownerKey, previewId)
  return true
}

export function focusWorkspacePreviewAddress(ownerKey: string) {
  const previewId = activeBrowserTabId(ownerKey)
  if (previewId === null) return false
  useWorkspacePanelStore.getState().showBrowser(ownerKey, previewId)
  requestAnimationFrame(() => {
    const address = document.querySelector<HTMLInputElement>('[aria-label="Preview address"]')
    address?.focus()
    address?.select()
  })
  return true
}

export async function refreshWorkspacePreview(ownerKey: string) {
  const previewId = activeBrowserPreviewId(ownerKey)
  if (previewId === null) return false
  await api.reloadBrowserPreview(previewId)
  return true
}

export async function zoomWorkspacePreview(ownerKey: string, action: 'in' | 'out' | 'reset') {
  const previewId = activeBrowserPreviewId(ownerKey)
  if (previewId === null) return false
  await api.zoomBrowserPreview(previewId, action)
  return true
}

export function useWorkspaceSideTerminalVisible(ownerKey: string) {
  return useWorkspacePanelStore((state) => {
    const group = state.groups[ownerKey]
    return group?.panelOpen === true && group.activeSurface?.kind === 'terminal'
  })
}
