import type {
  BrowserPreviewControllerState,
  BrowserPreviewFavicon,
} from '@shared/types/browser-preview'

export interface BrowserPreviewTab {
  readonly id: string
  readonly ownerKey: string
  readonly kind: 'launcher' | 'preview'
  readonly profileId: string
  readonly url: string
  readonly title: string
  readonly loading: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly error: string | null
  readonly audioMuted: boolean
  readonly audible: boolean
  readonly favicon: BrowserPreviewFavicon | null
  readonly controller: BrowserPreviewControllerState
}

export type BrowserPreviewTabPatch = Partial<Omit<BrowserPreviewTab, 'id' | 'kind' | 'ownerKey'>>

export interface BrowserPreviewMaterializedTab extends BrowserPreviewTab {
  readonly kind: 'preview'
}

export interface BrowserPreviewPanelCallbacks {
  readonly onClose: () => void
  readonly onError: (message: string) => void
  readonly onMaterialize: (url: string, profileId: string) => void
  readonly onUpdate: (patch: BrowserPreviewTabPatch) => void
}
