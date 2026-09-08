import type {
  BrowserImportInput,
  BrowserImportResult,
  BrowserImportSource,
  GuidedBrowserImportInput,
  GuidedBrowserImportResult,
} from './browser-import'
import type {
  BrowserPreviewBounds,
  BrowserPreviewOpenInput,
  BrowserPreviewReplacementResult,
  BrowserPreviewShortcutBindings,
  BrowserPreviewState,
  BrowserPreviewZoomAction,
} from './browser-preview'
import type {
  BrowserPreviewAnnotation,
  BrowserPreviewAppearance,
  BrowserPreviewRecordingArtifact,
  BrowserPreviewRecordingGrant,
  BrowserPreviewRecordingSaveInput,
  BrowserPreviewScreenshotArtifact,
  BrowserPreviewViewport,
} from './browser-preview-controls'
import type { BrowserPreviewOpenRequestAck } from './browser-preview-owner'
import type { BrowserPreviewRecordingRequestResponse } from './browser-preview-recording-request'
import type { IpcEventPayload } from './ipc'

export interface OpenWaggleBrowserPreviewApi {
  openBrowserPreview(input: BrowserPreviewOpenInput): Promise<BrowserPreviewState>
  setBrowserPreviewBounds(previewId: string, bounds: BrowserPreviewBounds | null): Promise<void>
  navigateBrowserPreview(previewId: string, url: string): Promise<BrowserPreviewState>
  goBackBrowserPreview(previewId: string): Promise<BrowserPreviewState>
  goForwardBrowserPreview(previewId: string): Promise<BrowserPreviewState>
  reloadBrowserPreview(previewId: string): Promise<BrowserPreviewState>
  stopBrowserPreview(previewId: string): Promise<BrowserPreviewState>
  closeBrowserPreview(previewId: string): Promise<void>
  replaceBrowserPreviewForCapacity(
    input: BrowserPreviewOpenInput,
    replacedPreviewId: string,
  ): Promise<BrowserPreviewReplacementResult>
  zoomBrowserPreview(previewId: string, action: BrowserPreviewZoomAction): Promise<number>
  setBrowserPreviewViewport(
    previewId: string,
    viewport: BrowserPreviewViewport,
  ): Promise<BrowserPreviewState>
  hardReloadBrowserPreview(previewId: string): Promise<BrowserPreviewState>
  setBrowserPreviewAppearance(
    previewId: string,
    appearance: BrowserPreviewAppearance,
  ): Promise<BrowserPreviewState>
  setBrowserPreviewAudioMuted(previewId: string, audioMuted: boolean): Promise<BrowserPreviewState>
  openBrowserPreviewDevTools(previewId: string): Promise<void>
  clearBrowserPreviewCookies(previewId: string): Promise<void>
  clearBrowserPreviewCache(previewId: string): Promise<void>
  captureBrowserPreviewScreenshot(previewId: string): Promise<BrowserPreviewScreenshotArtifact>
  revealBrowserPreviewArtifact(artifactPath: string): Promise<void>
  copyBrowserPreviewScreenshot(artifactPath: string): Promise<void>
  startBrowserPreviewRecording(previewId: string): Promise<BrowserPreviewRecordingGrant>
  saveBrowserPreviewRecording(
    input: BrowserPreviewRecordingSaveInput,
  ): Promise<BrowserPreviewRecordingArtifact>
  stopBrowserPreviewRecording(previewId: string): Promise<void>
  pickBrowserPreviewElement(previewId: string): Promise<BrowserPreviewAnnotation | null>
  cancelBrowserPreviewElementPick(previewId: string): Promise<void>
  openBrowserPreviewPictureInPicture(previewId: string): Promise<BrowserPreviewState>
  closeBrowserPreviewPictureInPicture(previewId: string): Promise<BrowserPreviewState>
  registerBrowserPreviewOwner(ownerKey: string): Promise<void>
  unregisterBrowserPreviewOwner(ownerKey: string): Promise<void>
  acknowledgeBrowserPreviewOpenRequest(acknowledgment: BrowserPreviewOpenRequestAck): Promise<void>
  setCurrentBrowserPreview(ownerKey: string, previewId: string | null): Promise<void>
  respondBrowserPreviewRecordingRequest(
    response: BrowserPreviewRecordingRequestResponse,
  ): Promise<void>
  setBrowserPreviewShortcutBindings(bindings: BrowserPreviewShortcutBindings): Promise<void>
  listBrowserImportSources(): Promise<readonly BrowserImportSource[]>
  importBrowserCookies(input: BrowserImportInput): Promise<BrowserImportResult>
  guidedImportBrowserCookies(input: GuidedBrowserImportInput): Promise<GuidedBrowserImportResult>
  openBrowserImportFullDiskAccessSettings(): Promise<boolean>
  clearBrowserProfileData(profileId: string): Promise<void>
  onBrowserPreviewState(
    callback: (payload: IpcEventPayload<'browser-preview:state'>) => void,
  ): () => void
  onBrowserPreviewShortcut(
    callback: (payload: IpcEventPayload<'browser-preview:shortcut'>) => void,
  ): () => void
  onBrowserPreviewKeyEvent(
    callback: (payload: IpcEventPayload<'browser-preview:key-event'>) => void,
  ): () => void
  onBrowserPreviewOpenRequest(
    callback: (payload: IpcEventPayload<'browser-preview:open-request'>) => void,
  ): () => void
  onBrowserPreviewOpenRequestCancellation(
    callback: (payload: IpcEventPayload<'browser-preview:cancel-open-request'>) => void,
  ): () => void
  onBrowserPreviewRecordingRequest(
    callback: (payload: IpcEventPayload<'browser-preview:recording-request'>) => void,
  ): () => void
  onBrowserPreviewRecordingCancel(
    callback: (payload: IpcEventPayload<'browser-preview:recording-cancel'>) => void,
  ): () => void
}
