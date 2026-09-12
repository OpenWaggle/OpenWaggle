import type { BrowserPreviewOpenRequest } from '@shared/types/browser-preview-owner'
import type { StoreApi } from 'zustand'
import type { BrowserPreviewTabState, WorkspacePanelGroupState } from './workspace-panel-model'

export interface WorkspacePanelState {
  readonly groups: Record<string, WorkspacePanelGroupState>
  newBrowser: (
    ownerKey: string,
    profileId?: string,
  ) => { readonly previewId: string; readonly evictedPreviewId: string | null }
  openBrowser: (
    ownerKey: string,
    url: string,
    profileId?: string,
  ) => { readonly previewId: string; readonly evictedPreviewId: string | null }
  updateBrowser: (
    ownerKey: string,
    previewId: string,
    patch: Partial<Omit<BrowserPreviewTabState, 'id' | 'ownerKey'>>,
  ) => void
  materializeBrowser: (ownerKey: string, previewId: string, url: string, profileId: string) => void
  upsertBrowserRequest: (request: BrowserPreviewOpenRequest) => {
    readonly evictedPreviewId: string | null
  }
  closeBrowser: (ownerKey: string, previewId: string) => void
  closeBrowsers: (ownerKey: string, previewIds: readonly string[]) => void
  showBrowser: (ownerKey: string, previewId: string) => void
  showTerminal: (ownerKey: string) => void
  hideTerminal: (ownerKey: string) => void
  hidePanel: (ownerKey: string) => void
  setMaximized: (ownerKey: string, maximized: boolean) => void
  migrateGroup: (fromOwnerKey: string, toOwnerKey: string) => void
  removeGroup: (ownerKey: string) => readonly string[]
}

export type WorkspacePanelSet = StoreApi<WorkspacePanelState>['setState']
export type WorkspacePanelGet = StoreApi<WorkspacePanelState>['getState']

export function setWorkspacePanelGroup(
  set: WorkspacePanelSet,
  get: WorkspacePanelGet,
  ownerKey: string,
  group: WorkspacePanelGroupState,
) {
  set({ groups: { ...get().groups, [ownerKey]: group } })
}
