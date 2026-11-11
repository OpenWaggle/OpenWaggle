import fs from 'node:fs/promises'
import { ElectrobunBrowserPreviewManager } from './electrobun-preview-manager'
import { ElectrobunPreviewProfiles } from './electrobun-preview-profiles'
import type { ElectrobunPreviewHost } from './electrobun-preview-record-factory'
import type { BrowserPreviewViewsShape } from '../../../ports/desktop-shell/browser-preview-views'

const UNSUPPORTED = {
  recording: 'Recording a browser preview is not available on this desktop shell yet.',
  picker: 'Picking page elements is not available on this desktop shell yet.',
  pictureInPicture: 'Picture in picture is not available on this desktop shell yet.',
} as const

/** The Browser preview as Electrobun CEF `BrowserView`s driven over CEF's DevTools endpoint. */
export function makeElectrobunBrowserPreviewViews(
  host: ElectrobunPreviewHost,
): BrowserPreviewViewsShape {
  const manager = new ElectrobunBrowserPreviewManager(host)
  const profiles = new ElectrobunPreviewProfiles(host)
  const { controls } = manager
  const preview = manager.requirePreview.bind(manager)
  return {
    registerOwner: (ownerKey, owner) => manager.ownerRegistry.register(ownerKey, owner),
    unregisterOwner: (ownerKey, owner) => manager.ownerRegistry.unregister(ownerKey, owner),
    acknowledgeOpenRequest: (owner, acknowledgment) =>
      manager.ownerRegistry.acknowledge(owner, acknowledgment),
    isOwnerRegistered: (ownerKey) => manager.ownerRegistry.isRegistered(ownerKey),
    ownedPreviewCount: (ownerKey) => manager.listOwnedPreviews(ownerKey).length,
    setCurrentPreview: (owner, ownerKey, previewId) =>
      manager.setCurrentPreview(owner, ownerKey, previewId),
    forgetOwnerSelection: (owner, ownerKey) => manager.forgetOwnerSelection(owner, ownerKey),
    open: (owner, input) => manager.open(owner, input),
    replaceForCapacity: (owner, input, replacedPreviewId) =>
      manager.replaceForCapacity(owner, input, replacedPreviewId),
    setBounds: (owner, previewId, bounds) => manager.setBounds(owner, previewId, bounds),
    navigate: (owner, previewId, url) => manager.navigate(owner, previewId, url),
    goBack: (owner, previewId) =>
      manager.command(owner, previewId, (record) => record.guest.goBack(), false),
    goForward: (owner, previewId) =>
      manager.command(owner, previewId, (record) => record.guest.goForward(), false),
    reload: (owner, previewId) =>
      manager.command(owner, previewId, (record) => record.guest.reload(false)),
    hardReload: (owner, previewId) =>
      manager.command(owner, previewId, (record) => record.guest.reload(true)),
    stop: (owner, previewId) =>
      manager.command(owner, previewId, (record) => record.guest.stop(), false),
    close: (owner, previewId) => manager.close(owner, previewId),
    zoom: (owner, previewId, action) => controls.zoom(preview(owner, previewId), action),
    setViewport: (owner, previewId, viewport) =>
      controls.setViewport(preview(owner, previewId), viewport),
    setAppearance: (owner, previewId, appearance) =>
      controls.setAppearance(preview(owner, previewId), appearance),
    setAudioMuted: (owner, previewId, audioMuted) =>
      controls.setAudioMuted(preview(owner, previewId), audioMuted),
    setShortcutBindings: (owner, bindings) => manager.setShortcutBindings(owner, bindings),
    openDevTools: (owner, previewId) => controls.openDevTools(preview(owner, previewId)),
    clearCookies: (owner, previewId) => controls.clearCookies(preview(owner, previewId)),
    clearCache: (owner, previewId) => controls.clearCache(preview(owner, previewId)),
    captureScreenshot: (owner, previewId) => controls.captureScreenshot(preview(owner, previewId)),
    revealArtifact: (owner, artifactPath) => {
      manager.requireOwner(owner)
      return controls.revealArtifact(artifactPath)
    },
    copyScreenshot: (owner, artifactPath) => {
      manager.requireOwner(owner)
      return controls.copyScreenshot(artifactPath, (file) => fs.readFile(file))
    },
    startRecording: async (owner, previewId) => {
      preview(owner, previewId)
      throw new Error(UNSUPPORTED.recording)
    },
    saveRecording: async (owner, input) => {
      preview(owner, input.previewId)
      throw new Error(UNSUPPORTED.recording)
    },
    stopRecording: (owner, previewId) => void preview(owner, previewId),
    respondToRecordingRequest: (owner) => {
      manager.requireOwner(owner)
      throw new Error(UNSUPPORTED.recording)
    },
    pickElement: async (owner, previewId) => {
      preview(owner, previewId)
      throw new Error(UNSUPPORTED.picker)
    },
    cancelPickElement: async (owner, previewId) => void preview(owner, previewId),
    openPictureInPicture: async (owner, previewId) => {
      preview(owner, previewId)
      throw new Error(UNSUPPORTED.pictureInPicture)
    },
    closePictureInPicture: (owner, previewId) => preview(owner, previewId).state,
    closeForOwner: (ownerKey) => manager.closeForOwner(ownerKey),
    acquireMutationFence: (scope) => manager.acquireMutationFence(scope),
    beginShutdown: () => manager.beginShutdown(),
    closeAll: async () => {
      await Promise.all([manager.closeAll(), profiles.closeAll()])
    },
    clearProfileData: (profileId) => profiles.clearProfileData(profileId),
    profileCookieJar: (profileId) => profiles.cookieJar(profileId),
  }
}
