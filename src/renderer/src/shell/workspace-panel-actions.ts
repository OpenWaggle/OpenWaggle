import { match } from '@diegogbrisa/ts-match'
import {
  clearBrowserPreviewExternalFallback,
  normalizeBrowserPreviewUrl,
  useBrowserPreviewFloatingStore,
} from '@/features/browser-preview'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { RIGHT_PANEL_SIZING } from '@/shared/ui/right-sidebar-sizing-presets'
import { useUIStore } from './ui-store'
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
  try {
    const { evictedPreviewId } = useWorkspacePanelStore.getState().newBrowser(ownerKey, profileId)
    disposeEvictedPreview(ownerKey, evictedPreviewId)
    return true
  } catch (error) {
    useUIStore
      .getState()
      .showToast(error instanceof Error ? error.message : 'Browser tab could not open.', 'error')
    return false
  }
}

/** Shows the current browser tab, or a new one when the Session has none (never toggles). */
export function showWorkspaceBrowser(ownerKey: string) {
  const previewId = activeBrowserTabId(ownerKey)
  if (previewId === null) return newWorkspaceBrowser(ownerKey)
  useWorkspacePanelStore.getState().showBrowser(ownerKey, previewId)
  return true
}

export function showWorkspaceSideTerminal(ownerKey: string) {
  useWorkspacePanelStore.getState().showTerminal(ownerKey)
}

export function hideWorkspaceSideTerminal(ownerKey: string) {
  useWorkspacePanelStore.getState().hideTerminal(ownerKey)
}

/**
 * Maximizes or restores the open Right panel, whichever surface it shows (ADR 0043). The state
 * belongs to the Session and is kept with its workspace panel group. Nothing opens implicitly.
 */
export function toggleWorkspacePanelMaximized(ownerKey: string) {
  if (rightPanelMaximizeUnavailableReason(ownerKey) !== null) return false
  const store = useWorkspacePanelStore.getState()
  store.setMaximized(ownerKey, store.groups[ownerKey]?.maximized !== true)
  return true
}

const OPEN_A_PANEL_FIRST = 'Open a panel first.'
const GUIDED_PANEL_KEEPS_WIDTH = 'The guided action panel keeps its width.'
const SHEET_KEEPS_WIDTH = 'Widen the window to maximize the panel.'
/** Where the Right panel becomes a sheet over the chat, which has no maximized size. */
export const RIGHT_PANEL_SHEET_QUERY = `(max-width: ${String(RIGHT_PANEL_SIZING.sheetBreakpointPx)}px)`

function rightPanelIsSheet() {
  return (
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia(RIGHT_PANEL_SHEET_QUERY).matches
  )
}

/** Why the Right panel cannot be maximized right now, or null when it can. */
export function rightPanelMaximizeUnavailableReason(ownerKey: string): string | null {
  if (ownerKey.length === 0) return OPEN_A_PANEL_FIRST
  const claim = useRightSidebarCoordinator.getState().activeClaim
  if (claim?.kind === 'action-panel') return GUIDED_PANEL_KEEPS_WIDTH
  if (rightPanelIsSheet()) return SHEET_KEEPS_WIDTH
  const group = useWorkspacePanelStore.getState().groups[ownerKey]
  const workspaceOpen = group?.panelOpen === true && group.activeSurface !== null
  return workspaceOpen || claim?.kind === 'route' ? null : OPEN_A_PANEL_FIRST
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
  match(group.activeSurface)
    .with({ kind: 'terminal' }, () => store.showTerminal(ownerKey))
    .with({ kind: 'action' }, ({ projectPath, runId }) =>
      store.showAction(ownerKey, projectPath, runId),
    )
    .with({ kind: 'browser' }, ({ previewId }) => store.showBrowser(ownerKey, previewId))
    .with({ kind: 'project-actions' }, () => store.showIndexSurface(ownerKey, 'project-actions'))
    .with({ kind: 'all-panels' }, () => store.showIndexSurface(ownerKey, 'all-panels'))
    .exhaustive()
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

export function openWorkspaceAction(ownerKey: string, projectPath: string, runId: string) {
  useWorkspacePanelStore.getState().showAction(ownerKey, projectPath, runId)
}
