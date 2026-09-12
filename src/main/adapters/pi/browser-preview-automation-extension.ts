import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type {
  BrowserPreviewAutomationScope,
  BrowserPreviewAutomationServiceShape,
} from '../../ports/browser-preview-automation-service'
import { registerBrowserPreviewInspectionTools } from './browser-preview-automation-inspection-tools'
import { registerBrowserPreviewInteractionTools } from './browser-preview-automation-interaction-tools'
import { registerBrowserPreviewNavigationTools } from './browser-preview-automation-navigation-tools'
import { registerBrowserPreviewRecordingTools } from './browser-preview-automation-recording-tools'

export function createBrowserPreviewAutomationExtension(input: {
  readonly scope: BrowserPreviewAutomationScope
  readonly service: BrowserPreviewAutomationServiceShape
}): ExtensionFactory {
  return (pi) => {
    const registration = { pi, scope: input.scope, service: input.service }
    registerBrowserPreviewInspectionTools(registration)
    registerBrowserPreviewNavigationTools(registration)
    registerBrowserPreviewInteractionTools(registration)
    registerBrowserPreviewRecordingTools(registration)
  }
}
