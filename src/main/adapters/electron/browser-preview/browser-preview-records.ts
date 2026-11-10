import type {
  BrowserPreviewBounds,
  BrowserPreviewKeyEvent,
  BrowserPreviewShortcutBindings,
  BrowserPreviewState,
} from '@shared/types/browser-preview'
import type { BrowserWindow, WebContents, WebContentsView } from 'electron'

export interface BrowserPreviewRecord {
  readonly previewId: string
  readonly ownerKey: string
  readonly profileId: string
  readonly view: WebContentsView
  readonly owner: BrowserPreviewOwnerRecord
  state: BrowserPreviewState
  bounds: BrowserPreviewBounds | null
  loadGeneration: number
  disposed: boolean
  readonly claimedShortcutKeys: Set<string>
  readonly onOwnerEventFailure: () => void
  readonly removeListeners: Array<() => void>
}

export interface BrowserPreviewOwnerRecord {
  readonly sender: WebContents
  readonly window: BrowserWindow
  readonly previews: Map<string, BrowserPreviewRecord>
  shortcutBindings: BrowserPreviewShortcutBindings
  readonly removeListeners: Array<() => void>
}

export interface BrowserPreviewEventActions {
  readonly snapshot: () => void
  readonly emitState: () => void
  readonly emitShortcut: (action: 'focus-location' | 'close') => void
  readonly emitKeyEvent: (event: BrowserPreviewKeyEvent) => void
  readonly navigate: (canonicalUrl: string) => void
  readonly reload: () => void
  readonly goBack: () => void
  readonly goForward: () => void
  readonly dispose: () => void
  readonly detachDestroyed: () => void
}
