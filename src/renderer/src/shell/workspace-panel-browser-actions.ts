import type { BrowserPreviewOpenRequest } from '@shared/types/browser-preview-owner'
import { DEFAULT_BROWSER_PROFILE_ID } from '@shared/types/browser-profile'
import {
  normalizeBrowserPreviewUrl,
  useBrowserPreviewFloatingStore,
} from '@/features/browser-preview'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import {
  type BrowserPreviewTabState,
  browserPreviewTitle,
  createBrowserPreviewLauncherTab,
  createBrowserPreviewTab,
  EMPTY_WORKSPACE_PANEL_GROUP,
  lastBrowserSurface,
  MAX_BROWSER_TABS,
  type WorkspacePanelGroupState,
} from './workspace-panel-model'
import {
  setWorkspacePanelGroup,
  type WorkspacePanelGet,
  type WorkspacePanelSet,
} from './workspace-panel-store-types'

function visibleBrowserPreviewIds(group: WorkspacePanelGroupState, ownerKey: string) {
  const previewIds = new Set<string>()
  if (group.activeSurface?.kind === 'browser') previewIds.add(group.activeSurface.previewId)
  const floating = useBrowserPreviewFloatingStore.getState().byOwnerKey[ownerKey]
  if (floating !== undefined) previewIds.add(floating.previewId)
  return previewIds
}

export function openBrowser(
  set: WorkspacePanelSet,
  get: WorkspacePanelGet,
  ownerKey: string,
  url: string,
  profileId = DEFAULT_BROWSER_PROFILE_ID,
) {
  const normalizedUrl = normalizeBrowserPreviewUrl(url)
  if (normalizedUrl === null) throw new Error('Only http and https links can be previewed.')
  const existing = get().groups[ownerKey] ?? EMPTY_WORKSPACE_PANEL_GROUP
  const matching = existing.browserTabs.find(
    (tab) => tab.kind === 'preview' && tab.url === normalizedUrl && tab.profileId === profileId,
  )
  if (matching !== undefined) {
    setWorkspacePanelGroup(set, get, ownerKey, {
      ...existing,
      activeSurface: { kind: 'browser', previewId: matching.id },
      panelOpen: true,
    })
    useRightSidebarCoordinator.getState().claimWorkspace(ownerKey)
    return { previewId: matching.id, evictedPreviewId: null }
  }

  const tab = createBrowserPreviewTab(ownerKey, normalizedUrl, profileId)
  const evicted =
    existing.browserTabs.length >= MAX_BROWSER_TABS ? existing.browserTabs[0] : undefined
  const browserTabs = [...(evicted ? existing.browserTabs.slice(1) : existing.browserTabs), tab]
  setWorkspacePanelGroup(set, get, ownerKey, {
    ...existing,
    browserTabs,
    activeSurface: { kind: 'browser', previewId: tab.id },
    panelOpen: true,
  })
  useRightSidebarCoordinator.getState().claimWorkspace(ownerKey)
  return { previewId: tab.id, evictedPreviewId: evicted?.id ?? null }
}

export function newBrowser(
  set: WorkspacePanelSet,
  get: WorkspacePanelGet,
  ownerKey: string,
  profileId = DEFAULT_BROWSER_PROFILE_ID,
) {
  if (ownerKey.length === 0) throw new Error('Open a project before creating a browser tab.')
  const existing = get().groups[ownerKey] ?? EMPTY_WORKSPACE_PANEL_GROUP
  const tab = createBrowserPreviewLauncherTab(ownerKey, profileId)
  const evicted =
    existing.browserTabs.length >= MAX_BROWSER_TABS ? existing.browserTabs[0] : undefined
  const browserTabs = [...(evicted ? existing.browserTabs.slice(1) : existing.browserTabs), tab]
  setWorkspacePanelGroup(set, get, ownerKey, {
    ...existing,
    browserTabs,
    activeSurface: { kind: 'browser', previewId: tab.id },
    panelOpen: true,
  })
  useRightSidebarCoordinator.getState().claimWorkspace(ownerKey)
  return { previewId: tab.id, evictedPreviewId: evicted?.id ?? null }
}

export function updateBrowser(
  set: WorkspacePanelSet,
  get: WorkspacePanelGet,
  ownerKey: string,
  previewId: string,
  patch: Partial<Omit<BrowserPreviewTabState, 'id' | 'ownerKey'>>,
) {
  const group = get().groups[ownerKey]
  if (group === undefined) return
  setWorkspacePanelGroup(set, get, ownerKey, {
    ...group,
    browserTabs: group.browserTabs.map((tab) =>
      tab.id === previewId ? { ...tab, ...patch } : tab,
    ),
  })
}

export function materializeBrowser(
  set: WorkspacePanelSet,
  get: WorkspacePanelGet,
  ownerKey: string,
  previewId: string,
  url: string,
  profileId: string,
) {
  const normalizedUrl = normalizeBrowserPreviewUrl(url)
  if (normalizedUrl === null) throw new Error('Only http and https links can be previewed.')
  const group = get().groups[ownerKey]
  const current = group?.browserTabs.find((tab) => tab.id === previewId)
  if (group === undefined || current === undefined) return
  setWorkspacePanelGroup(set, get, ownerKey, {
    ...group,
    browserTabs: group.browserTabs.map((tab) =>
      tab.id === previewId
        ? {
            ...tab,
            kind: 'preview',
            profileId,
            url: normalizedUrl,
            title: browserPreviewTitle(normalizedUrl),
            loading: true,
            canGoBack: false,
            canGoForward: false,
            error: null,
            audible: false,
            favicon: null,
            controller: { kind: 'human' },
          }
        : tab,
    ),
  })
}

export function upsertBrowserRequest(
  set: WorkspacePanelSet,
  get: WorkspacePanelGet,
  request: BrowserPreviewOpenRequest,
) {
  const existing = get().groups[request.ownerKey] ?? EMPTY_WORKSPACE_PANEL_GROUP
  const current = existing.browserTabs.find((tab) => tab.id === request.previewId)
  if (
    current &&
    (current.ownerKey !== request.ownerKey || current.profileId !== request.profileId)
  ) {
    throw new Error('Browser preview owner and profile cannot change after creation.')
  }
  const requestedTab: BrowserPreviewTabState = current
    ? {
        ...current,
        kind: 'preview',
        url: request.url,
        title: browserPreviewTitle(request.url),
        loading: true,
        error: null,
        audible: false,
        favicon: null,
      }
    : createBrowserPreviewTab(request.ownerKey, request.url, request.profileId, request.previewId)
  const withoutRequested = existing.browserTabs.filter((tab) => tab.id !== request.previewId)
  const visiblePreviewIds = visibleBrowserPreviewIds(existing, request.ownerKey)
  const evicted = current
    ? undefined
    : withoutRequested.length >= MAX_BROWSER_TABS
      ? (withoutRequested.find((tab) => !visiblePreviewIds.has(tab.id)) ?? withoutRequested[0])
      : undefined
  const retained = evicted
    ? withoutRequested.filter((tab) => tab.id !== evicted.id)
    : withoutRequested
  const browserTabs = [...retained, requestedTab]
  const activeSurface = request.activate
    ? { kind: 'browser' as const, previewId: request.previewId }
    : existing.activeSurface
  setWorkspacePanelGroup(set, get, request.ownerKey, {
    ...existing,
    browserTabs,
    activeSurface,
    panelOpen: existing.panelOpen,
  })
  return { evictedPreviewId: evicted?.id ?? null }
}

export function closeBrowsers(
  set: WorkspacePanelSet,
  get: WorkspacePanelGet,
  ownerKey: string,
  previewIds: readonly string[],
) {
  if (previewIds.length === 0) return
  for (const previewId of previewIds) {
    useBrowserPreviewFloatingStore.getState().removePreview(ownerKey, previewId)
  }
  const group = get().groups[ownerKey]
  if (group === undefined) return
  const closing = new Set(previewIds)
  const browserTabs = group.browserTabs.filter((tab) => !closing.has(tab.id))
  const activeSurface =
    group.activeSurface?.kind === 'browser' && closing.has(group.activeSurface.previewId)
      ? lastBrowserSurface(browserTabs)
      : group.activeSurface
  const panelOpen = activeSurface === null ? false : group.panelOpen
  setWorkspacePanelGroup(set, get, ownerKey, { ...group, browserTabs, activeSurface, panelOpen })
  if (!panelOpen) useRightSidebarCoordinator.getState().releaseWorkspace(ownerKey)
}
