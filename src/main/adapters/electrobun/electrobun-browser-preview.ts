import { Effect, Layer } from 'effect'
import { createElectrobunBrowserPreview } from './electrobun-browser-preview-views'
import { makeBrowserPreviewAutomationService } from '../browser-preview/automation/browser-preview-automation-service'
import { appPaths } from '../../desktop-shell/app-paths'
import { browserEngine } from '../../desktop-shell/browser-engine'
import { clipboard } from '../../desktop-shell/clipboard'
import { osShell } from '../../desktop-shell/os-shell'
import { BrowserPreviewAutomationService } from '../../ports/browser-preview-automation-service'
import type { BrowserPreviewViewsShape } from '../../ports/desktop-shell/browser-preview-views'
import { SettingsService } from '../../services/settings-service'

/** The app's one set of CEF previews, shared by the owner pages and the agent's tools. */
const electrobunBrowserPreview = createElectrobunBrowserPreview({
  appPaths,
  clipboard,
  engine: browserEngine,
  osShell,
})

export const electrobunBrowserPreviewViews: BrowserPreviewViewsShape =
  electrobunBrowserPreview.views

/** The agent's Browser preview tools over the CEF previews. */
export const ElectrobunBrowserPreviewAutomationServiceLive = Layer.effect(
  BrowserPreviewAutomationService,
  Effect.gen(function* () {
    const settings = yield* SettingsService
    return BrowserPreviewAutomationService.of(
      makeBrowserPreviewAutomationService(settings, electrobunBrowserPreview.automation),
    )
  }),
)
