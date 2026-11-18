import type { BrowserPreviewViewsShape } from '../../ports/desktop-shell/browser-preview-views'
import type { RendererSurface } from '../../ports/desktop-shell/renderer-surfaces'
import { browserPreviewManager } from './browser-preview/browser-preview'
import { browserPreviewOwnerRegistry } from './browser-preview/browser-preview-owner-registry'
import {
  browserPreviewSessionForProfile,
  clearBrowserPreviewProfileData,
} from './browser-preview/browser-preview-profile-session'
import { browserPreviewRecordingRequestBroker } from './browser-preview/browser-preview-recording-request-broker'
import { electronWebContentsOf } from './electron-window-policy'

/** The owner page's `WebContents`; Electron returns the same object that sent the request. */
function ownerContents(owner: RendererSurface) {
  const contents = electronWebContentsOf(owner)
  if (!contents) throw new Error('The window that owns this Browser preview has closed.')
  return contents
}

/** The Browser preview as Electron `WebContentsView`s with a `webContents.debugger` for CDP. */
export const electronBrowserPreviewViews: BrowserPreviewViewsShape = {
  registerOwner: (ownerKey, owner) =>
    browserPreviewOwnerRegistry.register(ownerKey, ownerContents(owner)),
  unregisterOwner: (ownerKey, owner) =>
    browserPreviewOwnerRegistry.unregister(ownerKey, ownerContents(owner)),
  acknowledgeOpenRequest: (owner, acknowledgment) =>
    browserPreviewOwnerRegistry.acknowledge(ownerContents(owner), acknowledgment),
  isOwnerRegistered: (ownerKey) => browserPreviewOwnerRegistry.isRegistered(ownerKey),
  ownedPreviewCount: (ownerKey) => browserPreviewManager.listOwnedPreviews(ownerKey).length,
  setCurrentPreview: (owner, ownerKey, previewId) =>
    browserPreviewManager.setCurrentPreview(ownerContents(owner), ownerKey, previewId),
  forgetOwnerSelection: (owner, ownerKey) =>
    browserPreviewManager.forgetOwnerSelection(ownerContents(owner), ownerKey),
  open: (owner, input) => browserPreviewManager.open(ownerContents(owner), input),
  replaceForCapacity: (owner, input, replacedPreviewId) =>
    browserPreviewManager.replaceForCapacity(ownerContents(owner), input, replacedPreviewId),
  setBounds: (owner, previewId, bounds) =>
    browserPreviewManager.setBounds(ownerContents(owner), previewId, bounds),
  navigate: (owner, previewId, url) =>
    browserPreviewManager.navigate(ownerContents(owner), previewId, url),
  goBack: (owner, previewId) => browserPreviewManager.goBack(ownerContents(owner), previewId),
  goForward: (owner, previewId) => browserPreviewManager.goForward(ownerContents(owner), previewId),
  reload: (owner, previewId) => browserPreviewManager.reload(ownerContents(owner), previewId),
  hardReload: (owner, previewId) =>
    browserPreviewManager.hardReload(ownerContents(owner), previewId),
  stop: (owner, previewId) => browserPreviewManager.stop(ownerContents(owner), previewId),
  close: (owner, previewId) => browserPreviewManager.close(ownerContents(owner), previewId),
  zoom: (owner, previewId, action) =>
    browserPreviewManager.zoom(ownerContents(owner), previewId, action),
  setViewport: (owner, previewId, viewport) =>
    browserPreviewManager.setViewport(ownerContents(owner), previewId, viewport),
  setAppearance: (owner, previewId, appearance) =>
    browserPreviewManager.setAppearance(ownerContents(owner), previewId, appearance),
  setAudioMuted: (owner, previewId, audioMuted) =>
    browserPreviewManager.setAudioMuted(ownerContents(owner), previewId, audioMuted),
  setShortcutBindings: (owner, bindings) =>
    browserPreviewManager.setShortcutBindings(ownerContents(owner), bindings),
  openDevTools: (owner, previewId) =>
    browserPreviewManager.openDevTools(ownerContents(owner), previewId),
  clearCookies: (owner, previewId) =>
    browserPreviewManager.clearCookies(ownerContents(owner), previewId),
  clearCache: (owner, previewId) =>
    browserPreviewManager.clearCache(ownerContents(owner), previewId),
  captureScreenshot: (owner, previewId) =>
    browserPreviewManager.captureScreenshot(ownerContents(owner), previewId),
  revealArtifact: (owner, artifactPath) =>
    browserPreviewManager.revealArtifact(ownerContents(owner), artifactPath),
  copyScreenshot: (owner, artifactPath) =>
    browserPreviewManager.copyScreenshot(ownerContents(owner), artifactPath),
  startRecording: (owner, previewId) =>
    browserPreviewManager.startRecording(ownerContents(owner), previewId),
  saveRecording: (owner, input) => browserPreviewManager.saveRecording(ownerContents(owner), input),
  stopRecording: (owner, previewId) =>
    browserPreviewManager.stopRecording(ownerContents(owner), previewId),
  respondToRecordingRequest: (owner, response) =>
    browserPreviewRecordingRequestBroker.respond(ownerContents(owner), response),
  pickElement: (owner, previewId) =>
    browserPreviewManager.pickElement(ownerContents(owner), previewId),
  cancelPickElement: (owner, previewId) =>
    browserPreviewManager.cancelPickElement(ownerContents(owner), previewId),
  openPictureInPicture: (owner, previewId) =>
    browserPreviewManager.openPictureInPicture(ownerContents(owner), previewId),
  closePictureInPicture: (owner, previewId) =>
    browserPreviewManager.closePictureInPicture(ownerContents(owner), previewId),
  closeForOwner: (ownerKey) => browserPreviewManager.closeForOwner(ownerKey),
  acquireMutationFence: (scope) => browserPreviewManager.acquireMutationFence(scope),
  beginShutdown: () => browserPreviewManager.beginShutdown(),
  closeAll: () => browserPreviewManager.closeAll(),
  clearProfileData: (profileId) => clearBrowserPreviewProfileData(profileId),
  profileCookieJar: (profileId) => browserPreviewSessionForProfile(profileId),
}
