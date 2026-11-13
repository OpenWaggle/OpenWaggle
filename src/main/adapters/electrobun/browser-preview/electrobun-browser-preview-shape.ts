import fs from 'node:fs/promises'
import { ElectrobunBrowserPreviewManager } from './electrobun-preview-manager'
import { ElectrobunPreviewAnnotations } from './electrobun-preview-annotations'
import { keepingPartitionsLoaded } from './electrobun-preview-profile-keepers'
import { ElectrobunPreviewProfiles } from './electrobun-preview-profiles'
import { electrobunAutomationShell } from './electrobun-preview-automation-shell'
import type { ElectrobunPreviewHost } from './electrobun-preview-record-factory'
import {
  ELECTROBUN_PREVIEW_UNSUPPORTED,
  type ElectrobunPreviewRecord,
} from './electrobun-preview-records'
import type { BrowserPreviewAutomationShell } from '../../browser-preview/automation/browser-preview-automation-service'
import {
  assertBrowserEngineReady,
  requireBrowserEngine,
} from '../../../ports/desktop-shell/browser-engine'
import type { BrowserPreviewViewsShape } from '../../../ports/desktop-shell/browser-preview-views'

/**
 * The host with every view creation behind the engine: on macOS a CEF view created without CEF
 * installed silently becomes a system webview, which has no DevTools endpoint.
 */
function engineGatedHost(host: ElectrobunPreviewHost): ElectrobunPreviewHost {
  return {
    ...host,
    createView: (options) => {
      assertBrowserEngineReady(host.engine)
      return host.createView(options)
    },
  }
}

/**
 * The Browser preview as Electrobun CEF `BrowserView`s driven over CEF's DevTools endpoint, and
 * the same previews as the agent's automation sees them.
 */
export function makeElectrobunBrowserPreview(shellHost: ElectrobunPreviewHost) {
  const host = engineGatedHost(shellHost)
  const partitions = keepingPartitionsLoaded(host)
  const manager = new ElectrobunBrowserPreviewManager(partitions.host)
  const profiles = new ElectrobunPreviewProfiles(partitions.host)
  const { controls } = manager
  const preview = manager.requirePreview.bind(manager)
  const annotations = new ElectrobunPreviewAnnotations(host, controls)
  const automation = electrobunAutomationShell({
    findTab: (ownerKey, tabId) => manager.findOwnedPreview(ownerKey, tabId),
    selectTab: (record, ownerKey) =>
      manager.setCurrentPreview(record.owner.sender, ownerKey, record.previewId),
    // The agent's open waits for the engine here, so a failed install is the tool's error.
    requestOpen: async (request, options) => {
      await requireBrowserEngine(host.engine)
      return manager.ownerRegistry.requestOpen(request, options)
    },
    beginNavigation: (record, url) => manager.beginNavigation(record, url),
    fail: (record, error) => controls.fail(record, error),
    setViewport: (record, viewport) => controls.setViewport(record, viewport),
    setAppearance: async (record, appearance) => {
      await controls.setAppearance(record, appearance)
    },
  })
  const views: BrowserPreviewViewsShape = {
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
      throw new Error(ELECTROBUN_PREVIEW_UNSUPPORTED.recording)
    },
    saveRecording: async (owner, input) => {
      preview(owner, input.previewId)
      throw new Error(ELECTROBUN_PREVIEW_UNSUPPORTED.recording)
    },
    stopRecording: (owner, previewId) => void preview(owner, previewId),
    respondToRecordingRequest: (owner) => {
      manager.requireOwner(owner)
      throw new Error(ELECTROBUN_PREVIEW_UNSUPPORTED.recording)
    },
    pickElement: async (owner, previewId) => annotations.pick(preview(owner, previewId)),
    cancelPickElement: async (owner, previewId) => annotations.cancel(preview(owner, previewId)),
    openPictureInPicture: async (owner, previewId) => {
      preview(owner, previewId)
      throw new Error(ELECTROBUN_PREVIEW_UNSUPPORTED.pictureInPicture)
    },
    closePictureInPicture: (owner, previewId) => preview(owner, previewId).state,
    closeForOwner: (ownerKey) => manager.closeForOwner(ownerKey),
    acquireMutationFence: (scope) => manager.acquireMutationFence(scope),
    beginShutdown: () => manager.beginShutdown(),
    closeAll: async () => {
      await Promise.all([manager.closeAll(), profiles.closeAll()])
      partitions.release()
    },
    clearProfileData: (profileId) => profiles.clearProfileData(profileId),
    profileCookieJar: (profileId) => profiles.cookieJar(profileId),
  }
  return { views, automation } satisfies {
    readonly views: BrowserPreviewViewsShape
    readonly automation: BrowserPreviewAutomationShell<ElectrobunPreviewRecord>
  }
}
