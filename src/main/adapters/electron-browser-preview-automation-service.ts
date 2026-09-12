import { Effect, Layer } from 'effect'
import {
  BrowserPreviewAutomationService,
  type BrowserPreviewAutomationServiceShape,
} from '../ports/browser-preview-automation-service'
import { SettingsService, type SettingsServiceShape } from '../services/settings-service'
import { createBrowserPreviewAutomationAccessGuard } from './electron-browser-preview-automation-effects'
import { makeBrowserPreviewAutomationLifecycleOperations } from './electron-browser-preview-automation-lifecycle'
import { makeBrowserPreviewAutomationPageOperations } from './electron-browser-preview-automation-page-operations'
import { makeBrowserPreviewAutomationRecordingOperations } from './electron-browser-preview-automation-recording'

export function makeBrowserPreviewAutomationService(
  settings: SettingsServiceShape,
): BrowserPreviewAutomationServiceShape {
  const withAgentAccess = createBrowserPreviewAutomationAccessGuard(settings)
  return {
    ...makeBrowserPreviewAutomationLifecycleOperations(settings, withAgentAccess),
    ...makeBrowserPreviewAutomationPageOperations(withAgentAccess),
    ...makeBrowserPreviewAutomationRecordingOperations(withAgentAccess),
  }
}

export const ElectronBrowserPreviewAutomationServiceLive = Layer.effect(
  BrowserPreviewAutomationService,
  Effect.gen(function* () {
    const settings = yield* SettingsService
    return BrowserPreviewAutomationService.of(makeBrowserPreviewAutomationService(settings))
  }),
)
