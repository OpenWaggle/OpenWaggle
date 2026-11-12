import type {
  BrowserPreviewControlState,
  BrowserPreviewInitialControls,
} from './browser-preview-controls'
import type { BrowserProfile } from './browser-profile'
import type { ShortcutBinding } from './shortcuts'

export const BROWSER_PREVIEW_LIMITS = {
  ID_LENGTH: 128,
  OWNER_KEY_LENGTH: 512,
  URL_LENGTH: 8_192,
  MAX_DIP: 32_768,
  SHORTCUT_BINDINGS: 512,
  FAVICON_DATA_URL_LENGTH: 8_192,
} as const

export interface BrowserPreviewBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** Presentation-only CSS viewport retained while a fill-mode page floats over chat. */
  readonly sourceViewport?: { readonly width: number; readonly height: number }
}

export interface BrowserPreviewOpenInput {
  readonly previewId: string
  /** Session-scoped owner used by renderer and Pi automation lookups. */
  readonly ownerKey: string
  /** Immutable storage profile for the lifetime of this native preview. */
  readonly profileId: BrowserProfile['id']
  readonly url: string
  readonly bounds: BrowserPreviewBounds
  readonly visible: boolean
  /** Per-tab user intent, carried across profile-bound native-view replacement. */
  readonly audioMuted?: boolean
  /** Starting controls applied before the guest loads, avoiding a wrong-size first frame. */
  readonly initialControls?: BrowserPreviewInitialControls
}

export interface BrowserPreviewFavicon {
  readonly dataUrl: string
  /** Canonical HTTP(S) origin whose document produced this icon. */
  readonly pageUrl: string
  readonly capturedAt: number
}

export interface BrowserPreviewError {
  readonly code: string
  readonly description: string
  readonly url: string
}

export interface BrowserPreviewAgentPointer {
  readonly x: number
  readonly y: number
}

export type BrowserPreviewControllerState =
  | { readonly kind: 'human' }
  | {
      readonly kind: 'agent'
      readonly action: string
      readonly pointer: BrowserPreviewAgentPointer | null
    }

export interface BrowserPreviewState {
  readonly previewId: string
  readonly ownerKey: string
  readonly profileId: BrowserProfile['id']
  readonly url: string
  readonly title: string
  readonly loading: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly error: BrowserPreviewError | null
  /** User mute intent; remains true even while a page is currently silent. */
  readonly audioMuted: boolean
  /** Chromium audibility, independent from mute intent. */
  readonly audible: boolean
  readonly favicon: BrowserPreviewFavicon | null
  readonly controller: BrowserPreviewControllerState
  readonly controls: BrowserPreviewControlState
}

export interface BrowserPreviewReplacementResult {
  readonly state: BrowserPreviewState
  readonly replacedState: BrowserPreviewState | null
}

export interface BrowserPreviewShortcutEvent {
  readonly previewId: string
  readonly action: 'focus-location' | 'close'
}

/** A physical key captured while native preview content owns keyboard focus. */
export interface BrowserPreviewKeyEvent {
  readonly previewId: string
  readonly type: 'keydown' | 'keyup'
  readonly key: string
  readonly code: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly isComposing: boolean
  readonly repeat: boolean
}

/** Chords that the renderer's ordered shortcut resolver may claim from native preview content. */
export type BrowserPreviewShortcutBindings = readonly ShortcutBinding[]

export const BROWSER_PREVIEW_ZOOM_ACTIONS = ['in', 'out', 'reset'] as const
export type BrowserPreviewZoomAction = (typeof BROWSER_PREVIEW_ZOOM_ACTIONS)[number]
