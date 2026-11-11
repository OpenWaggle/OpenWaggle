import { Effect, Layer } from 'effect'
import { browserPreviewManager } from './browser-preview'
import { navigateBrowserPreviewAndWait } from './browser-preview-automation-navigation'
import { browserPreviewAutomationPage } from './browser-preview-automation-page'
import { browserPreviewOwnerRegistry } from './browser-preview-owner-registry'
import type { BrowserPreviewRecord } from './browser-preview-records'
import { browserPreviewRecordingRequestBroker } from './browser-preview-recording-request-broker'
import {
  type BrowserPreviewAutomationShell,
  makeBrowserPreviewAutomationService as makeAutomationService,
} from '../../browser-preview/automation/browser-preview-automation-service'
import {
  BrowserPreviewAutomationService,
  type BrowserPreviewAutomationServiceShape,
} from '../../../ports/browser-preview-automation-service'
import { SettingsService, type SettingsServiceShape } from '../../../services/settings-service'

/** Electron's previews as the automation sees them: `WebContentsView`s with their debugger. */
const electronAutomationShell: BrowserPreviewAutomationShell<BrowserPreviewRecord> = {
  findTab: (ownerKey, tabId) => browserPreviewManager.findOwnedPreview(ownerKey, tabId),
  selectTab: (record, ownerKey) =>
    browserPreviewManager.setCurrentPreview(record.owner.sender, ownerKey, record.previewId),
  page: browserPreviewAutomationPage,
  requestOpen: (request, options) => browserPreviewOwnerRegistry.requestOpen(request, options),
  navigateAndWait: (record, navigation) =>
    navigateBrowserPreviewAndWait({
      contents: record.view.webContents,
      ...navigation,
      navigate: () =>
        browserPreviewManager.beginAutomationNavigation(
          record.owner.sender,
          record.previewId,
          navigation.url,
        ),
    }),
  setViewport: (record, viewport) =>
    browserPreviewManager.setViewport(record.owner.sender, record.previewId, viewport),
  setAppearance: async (record, appearance) => {
    await browserPreviewManager.setAppearance(record.owner.sender, record.previewId, appearance)
  },
  startRecording: (record, options) => browserPreviewRecordingRequestBroker.start(record, options),
  stopRecording: async (record, options) => {
    const artifact = await browserPreviewRecordingRequestBroker.stop(record, options)
    return {
      id: artifact.id,
      path: artifact.path,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      createdAt: artifact.createdAt,
    }
  },
}

export function makeBrowserPreviewAutomationService(settings: SettingsServiceShape) {
  return makeAutomationService(
    settings,
    electronAutomationShell,
  ) satisfies BrowserPreviewAutomationServiceShape
}

export const ElectronBrowserPreviewAutomationServiceLive = Layer.effect(
  BrowserPreviewAutomationService,
  Effect.gen(function* () {
    const settings = yield* SettingsService
    return BrowserPreviewAutomationService.of(makeBrowserPreviewAutomationService(settings))
  }),
)
