import type {
  BrowserPreviewBounds,
  BrowserPreviewOpenInput,
  BrowserPreviewReplacementResult,
  BrowserPreviewShortcutBindings,
  BrowserPreviewState,
  BrowserPreviewZoomAction,
} from '@shared/types/browser-preview'
import type {
  BrowserPreviewAnnotation,
  BrowserPreviewAppearance,
  BrowserPreviewRecordingArtifact,
  BrowserPreviewRecordingGrant,
  BrowserPreviewRecordingSaveInput,
  BrowserPreviewScreenshotArtifact,
  BrowserPreviewViewport,
} from '@shared/types/browser-preview-controls'
import type { BrowserPreviewOpenRequestAck } from '@shared/types/browser-preview-owner'
import type { BrowserPreviewRecordingRequestResponse } from '@shared/types/browser-preview-recording-request'
import type { DesktopMutationScope } from '@shared/types/desktop-service'
import { Context } from 'effect'
import type { ImportedBrowserCookie } from '../../browser-import/browser-cookie-model'
import type { RendererSurface } from './renderer-surfaces'

/** The cookie store of one Browser profile's persistent partition. */
export interface BrowserProfileCookieJar {
  readonly cookies: {
    readonly set: (cookie: ImportedBrowserCookie) => Promise<void>
    /** Writes the cookies set so far to disk. */
    readonly flushStore: () => Promise<void>
  }
}

/**
 * The Session-owned Browser preview (ADR 0031, ADR 0064): native web views a renderer owner
 * places over its own page, each in the persistent partition of a Browser profile, with an
 * automation debugger (CDP) the agent drives through `BrowserPreviewAutomationService`.
 *
 * Every renderer call names its `owner` page, the surface that sent the IPC request. A preview
 * belongs to the owner that opened it: calls from any other surface throw, and an owner that is
 * destroyed or navigates away loses its previews. Electron renders previews as `WebContentsView`s
 * in the owner's window; Electrobun renders `BrowserView`s, with CEF where CDP is needed.
 */
export interface BrowserPreviewViewsShape {
  readonly registerOwner: (ownerKey: string, owner: RendererSurface) => void
  readonly unregisterOwner: (ownerKey: string, owner: RendererSurface) => void
  readonly acknowledgeOpenRequest: (
    owner: RendererSurface,
    acknowledgment: BrowserPreviewOpenRequestAck,
  ) => void
  readonly isOwnerRegistered: (ownerKey: string) => boolean
  readonly ownedPreviewCount: (ownerKey: string) => number
  readonly setCurrentPreview: (
    owner: RendererSurface,
    ownerKey: string,
    previewId: string | null,
  ) => void
  readonly forgetOwnerSelection: (owner: RendererSurface, ownerKey: string) => void
  readonly open: (owner: RendererSurface, input: BrowserPreviewOpenInput) => BrowserPreviewState
  readonly replaceForCapacity: (
    owner: RendererSurface,
    input: BrowserPreviewOpenInput,
    replacedPreviewId: string,
  ) => BrowserPreviewReplacementResult
  readonly setBounds: (
    owner: RendererSurface,
    previewId: string,
    bounds: BrowserPreviewBounds | null,
  ) => void
  readonly navigate: (owner: RendererSurface, previewId: string, url: string) => BrowserPreviewState
  readonly goBack: (owner: RendererSurface, previewId: string) => BrowserPreviewState
  readonly goForward: (owner: RendererSurface, previewId: string) => BrowserPreviewState
  readonly reload: (owner: RendererSurface, previewId: string) => BrowserPreviewState
  readonly hardReload: (owner: RendererSurface, previewId: string) => BrowserPreviewState
  readonly stop: (owner: RendererSurface, previewId: string) => BrowserPreviewState
  readonly close: (owner: RendererSurface, previewId: string) => Promise<void>
  readonly zoom: (
    owner: RendererSurface,
    previewId: string,
    action: BrowserPreviewZoomAction,
  ) => number
  readonly setViewport: (
    owner: RendererSurface,
    previewId: string,
    viewport: BrowserPreviewViewport,
  ) => BrowserPreviewState
  readonly setAppearance: (
    owner: RendererSurface,
    previewId: string,
    appearance: BrowserPreviewAppearance,
  ) => Promise<BrowserPreviewState>
  readonly setAudioMuted: (
    owner: RendererSurface,
    previewId: string,
    audioMuted: boolean,
  ) => BrowserPreviewState
  readonly setShortcutBindings: (
    owner: RendererSurface,
    bindings: BrowserPreviewShortcutBindings,
  ) => void
  readonly openDevTools: (owner: RendererSurface, previewId: string) => Promise<void>
  readonly clearCookies: (owner: RendererSurface, previewId: string) => Promise<void>
  readonly clearCache: (owner: RendererSurface, previewId: string) => Promise<void>
  readonly captureScreenshot: (
    owner: RendererSurface,
    previewId: string,
  ) => Promise<BrowserPreviewScreenshotArtifact>
  readonly revealArtifact: (owner: RendererSurface, artifactPath: string) => Promise<void>
  readonly copyScreenshot: (owner: RendererSurface, artifactPath: string) => Promise<void>
  readonly startRecording: (
    owner: RendererSurface,
    previewId: string,
  ) => Promise<BrowserPreviewRecordingGrant>
  readonly saveRecording: (
    owner: RendererSurface,
    input: BrowserPreviewRecordingSaveInput,
  ) => Promise<BrowserPreviewRecordingArtifact>
  readonly stopRecording: (owner: RendererSurface, previewId: string) => void
  readonly respondToRecordingRequest: (
    owner: RendererSurface,
    response: BrowserPreviewRecordingRequestResponse,
  ) => void
  readonly pickElement: (
    owner: RendererSurface,
    previewId: string,
  ) => Promise<BrowserPreviewAnnotation | null>
  readonly cancelPickElement: (owner: RendererSurface, previewId: string) => Promise<void>
  readonly openPictureInPicture: (
    owner: RendererSurface,
    previewId: string,
  ) => Promise<BrowserPreviewState>
  readonly closePictureInPicture: (owner: RendererSurface, previewId: string) => BrowserPreviewState
  /** Closes every preview of a deleted Session owner. */
  readonly closeForOwner: (ownerKey: string) => Promise<void>
  /** Holds Session deletion and preview creation apart for `scope`; call the result to release. */
  readonly acquireMutationFence: (scope: DesktopMutationScope) => Promise<() => void>
  /** From now on no preview opens; the app is quitting. */
  readonly beginShutdown: () => void
  readonly closeAll: () => Promise<void>
  /** Deletes a Browser profile's cookies, storage and cache. */
  readonly clearProfileData: (profileId: string) => Promise<void>
  /** Opens a Browser profile's cookie store, to import cookies into it. */
  readonly profileCookieJar: (profileId: string) => BrowserProfileCookieJar
}

export class BrowserPreviewViews extends Context.Tag('@openwaggle/BrowserPreviewViews')<
  BrowserPreviewViews,
  BrowserPreviewViewsShape
>() {}
