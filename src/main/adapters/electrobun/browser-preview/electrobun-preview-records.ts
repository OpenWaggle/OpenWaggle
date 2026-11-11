import type {
  BrowserPreviewBounds,
  BrowserPreviewShortcutBindings,
  BrowserPreviewState,
} from '@shared/types/browser-preview'
import type { ElectrobunPreviewGuest } from './electrobun-preview-guest'
import type { RendererSurface } from '../../../ports/desktop-shell/renderer-surfaces'

/** A renderer page that owns CEF previews, in the Electrobun window that hosts them. */
export interface ElectrobunPreviewOwner {
  readonly sender: RendererSurface
  readonly windowId: number
  readonly previews: Map<string, ElectrobunPreviewRecord>
  shortcutBindings: BrowserPreviewShortcutBindings
  readonly removeListeners: (() => void)[]
}

/** One CEF preview: its native view and CDP guest, and the state its owner sees. */
export interface ElectrobunPreviewRecord {
  readonly previewId: string
  readonly ownerKey: string
  readonly profileId: string
  readonly owner: ElectrobunPreviewOwner
  readonly guest: ElectrobunPreviewGuest
  readonly webviewId: number
  state: BrowserPreviewState
  bounds: BrowserPreviewBounds | null
  disposed: boolean
  readonly claimedShortcutKeys: Set<string>
  readonly onOwnerEventFailure: () => void
  /** Called once when the native view is removed, for any reason. */
  readonly destroyedListeners: (() => void)[]
}

/** What CEF previews cannot do yet, as the errors the owner page and the agent see. */
export const ELECTROBUN_PREVIEW_UNSUPPORTED = {
  recording: 'Recording a browser preview is not available on this desktop shell yet.',
  picker: 'Picking page elements is not available on this desktop shell yet.',
  pictureInPicture: 'Picture in picture is not available on this desktop shell yet.',
} as const
