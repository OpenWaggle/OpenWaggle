import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useBrowserPreviewFloatingStore } from '@/features/browser-preview'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import {
  closeBrowsers,
  materializeBrowser,
  newBrowser,
  openBrowser,
  updateBrowser,
  upsertBrowserRequest,
} from './workspace-panel-browser-actions'
import { EMPTY_WORKSPACE_PANEL_GROUP, lastBrowserSurface } from './workspace-panel-model'
import {
  resolveWorkspacePanelStorage,
  sanitizeWorkspacePanelGroups,
  WORKSPACE_PANEL_STORAGE_KEY,
} from './workspace-panel-persistence'
import {
  setWorkspacePanelGroup,
  type WorkspacePanelGet,
  type WorkspacePanelSet,
  type WorkspacePanelState,
} from './workspace-panel-store-types'

export type {
  BrowserPreviewTabState,
  WorkspacePanelGroupState,
  WorkspacePanelSurface,
} from './workspace-panel-model'

function removeStoredGroup(set: WorkspacePanelSet, get: WorkspacePanelGet, ownerKey: string) {
  const groups = { ...get().groups }
  delete groups[ownerKey]
  set({ groups })
}

function showBrowser(
  set: WorkspacePanelSet,
  get: WorkspacePanelGet,
  ownerKey: string,
  previewId: string,
) {
  const group = get().groups[ownerKey]
  if (group === undefined || !group.browserTabs.some((tab) => tab.id === previewId)) return
  setWorkspacePanelGroup(set, get, ownerKey, {
    ...group,
    activeSurface: { kind: 'browser', previewId },
    panelOpen: true,
  })
  useRightSidebarCoordinator.getState().claimWorkspace(ownerKey)
}

function showTerminal(set: WorkspacePanelSet, get: WorkspacePanelGet, ownerKey: string) {
  if (ownerKey.length === 0) return
  setWorkspacePanelGroup(set, get, ownerKey, {
    ...(get().groups[ownerKey] ?? EMPTY_WORKSPACE_PANEL_GROUP),
    activeSurface: { kind: 'terminal' },
    panelOpen: true,
  })
  useRightSidebarCoordinator.getState().claimWorkspace(ownerKey)
}

function hideTerminal(set: WorkspacePanelSet, get: WorkspacePanelGet, ownerKey: string) {
  const group = get().groups[ownerKey]
  if (group === undefined || group.activeSurface?.kind !== 'terminal') return
  const activeSurface = lastBrowserSurface(group.browserTabs)
  const panelOpen = activeSurface !== null
  setWorkspacePanelGroup(set, get, ownerKey, { ...group, activeSurface, panelOpen })
  if (!panelOpen) useRightSidebarCoordinator.getState().releaseWorkspace(ownerKey)
}

function hidePanel(set: WorkspacePanelSet, get: WorkspacePanelGet, ownerKey: string) {
  const group = get().groups[ownerKey]
  if (group?.panelOpen) {
    setWorkspacePanelGroup(set, get, ownerKey, { ...group, panelOpen: false })
  }
  useRightSidebarCoordinator.getState().releaseWorkspace(ownerKey)
}

function setMaximized(
  set: WorkspacePanelSet,
  get: WorkspacePanelGet,
  ownerKey: string,
  maximized: boolean,
) {
  const group = get().groups[ownerKey]
  if (group === undefined || group.maximized === maximized) return
  setWorkspacePanelGroup(set, get, ownerKey, { ...group, maximized })
}

function migrateGroup(
  set: WorkspacePanelSet,
  get: WorkspacePanelGet,
  fromOwnerKey: string,
  toOwnerKey: string,
) {
  if (fromOwnerKey === toOwnerKey || fromOwnerKey.length === 0 || toOwnerKey.length === 0) return
  const source = get().groups[fromOwnerKey]
  if (source === undefined) return
  const groups = { ...get().groups }
  delete groups[fromOwnerKey]
  groups[toOwnerKey] = {
    ...source,
    browserTabs: source.browserTabs.map((tab) => ({ ...tab, ownerKey: toOwnerKey })),
  }
  set({ groups })
  useBrowserPreviewFloatingStore.getState().migrateOwner(fromOwnerKey, toOwnerKey)
  const activeClaim = useRightSidebarCoordinator.getState().activeClaim
  if (activeClaim?.kind === 'workspace' && activeClaim.ownerKey === fromOwnerKey) {
    useRightSidebarCoordinator.getState().claimWorkspace(toOwnerKey)
  }
}

function removeGroup(set: WorkspacePanelSet, get: WorkspacePanelGet, ownerKey: string) {
  const previewIds = get().groups[ownerKey]?.browserTabs.map((tab) => tab.id) ?? []
  removeStoredGroup(set, get, ownerKey)
  useBrowserPreviewFloatingStore.getState().removeOwner(ownerKey)
  useRightSidebarCoordinator.getState().releaseWorkspace(ownerKey)
  return previewIds
}

function createWorkspacePanelState(
  set: WorkspacePanelSet,
  get: WorkspacePanelGet,
): WorkspacePanelState {
  return {
    groups: {},
    newBrowser: (ownerKey, profileId) => newBrowser(set, get, ownerKey, profileId),
    openBrowser: (ownerKey, url, profileId) => openBrowser(set, get, ownerKey, url, profileId),
    updateBrowser: (ownerKey, previewId, patch) =>
      updateBrowser(set, get, ownerKey, previewId, patch),
    materializeBrowser: (ownerKey, previewId, url, profileId) =>
      materializeBrowser(set, get, ownerKey, previewId, url, profileId),
    upsertBrowserRequest: (request) => upsertBrowserRequest(set, get, request),
    closeBrowser: (ownerKey, previewId) => closeBrowsers(set, get, ownerKey, [previewId]),
    closeBrowsers: (ownerKey, previewIds) => closeBrowsers(set, get, ownerKey, previewIds),
    showBrowser: (ownerKey, previewId) => showBrowser(set, get, ownerKey, previewId),
    showTerminal: (ownerKey) => showTerminal(set, get, ownerKey),
    hideTerminal: (ownerKey) => hideTerminal(set, get, ownerKey),
    hidePanel: (ownerKey) => hidePanel(set, get, ownerKey),
    setMaximized: (ownerKey, maximized) => setMaximized(set, get, ownerKey, maximized),
    migrateGroup: (fromOwnerKey, toOwnerKey) => migrateGroup(set, get, fromOwnerKey, toOwnerKey),
    removeGroup: (ownerKey) => removeGroup(set, get, ownerKey),
  }
}

export const useWorkspacePanelStore = create<WorkspacePanelState>()(
  persist(createWorkspacePanelState, {
    name: WORKSPACE_PANEL_STORAGE_KEY,
    storage: createJSONStorage(resolveWorkspacePanelStorage),
    partialize: (state) => ({ groups: state.groups }),
    merge: (persisted, current) => ({
      ...current,
      groups: sanitizeWorkspacePanelGroups(
        persisted !== null && typeof persisted === 'object'
          ? Reflect.get(persisted, 'groups')
          : undefined,
      ),
    }),
  }),
)
