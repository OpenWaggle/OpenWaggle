import { browserPreviewAutomationController } from '../browser-preview-automation-control'
import { browserPreviewAutomationPage } from '../browser-preview-automation-page'
import {
  clickBrowserPreviewPage,
  evaluateBrowserPreviewPage,
  pressBrowserPreviewKey,
  scrollBrowserPreviewPage,
  typeIntoBrowserPreviewPage,
  waitForBrowserPreviewPage,
} from '../browser-preview-automation-page-actions'
import { captureBrowserPreviewAutomationSnapshot } from '../browser-preview-automation-snapshot'
import type { BrowserPreviewAutomationServiceShape } from '../ports/browser-preview-automation-service'
import {
  type BrowserPreviewAutomationAccessGuard,
  browserPreviewAutomationPromiseEffect,
} from './electron-browser-preview-automation-effects'
import { requireBrowserPreviewAutomationRecord } from './electron-browser-preview-automation-records'

type BrowserPreviewAutomationPageOperations = Pick<
  BrowserPreviewAutomationServiceShape,
  'snapshot' | 'click' | 'type' | 'press' | 'scroll' | 'evaluate' | 'waitFor'
>

export function makeBrowserPreviewAutomationPageOperations(
  withAgentAccess: BrowserPreviewAutomationAccessGuard,
): BrowserPreviewAutomationPageOperations {
  return {
    snapshot: (scope, input) =>
      withAgentAccess(
        browserPreviewAutomationPromiseEffect((signal) => {
          const record = requireBrowserPreviewAutomationRecord(scope, input)
          return captureBrowserPreviewAutomationSnapshot(
            browserPreviewAutomationController,
            browserPreviewAutomationPage(record),
            signal,
          )
        }),
      ),
    click: (scope, input) =>
      withAgentAccess(
        browserPreviewAutomationPromiseEffect((signal) => {
          const record = requireBrowserPreviewAutomationRecord(scope, input)
          return clickBrowserPreviewPage(
            browserPreviewAutomationController,
            browserPreviewAutomationPage(record),
            input,
            signal,
          )
        }),
      ),
    type: (scope, input) =>
      withAgentAccess(
        browserPreviewAutomationPromiseEffect((signal) => {
          const record = requireBrowserPreviewAutomationRecord(scope, input)
          return typeIntoBrowserPreviewPage(
            browserPreviewAutomationController,
            browserPreviewAutomationPage(record),
            input,
            signal,
          )
        }),
      ),
    press: (scope, input) =>
      withAgentAccess(
        browserPreviewAutomationPromiseEffect((signal) => {
          const record = requireBrowserPreviewAutomationRecord(scope, input)
          return pressBrowserPreviewKey(
            browserPreviewAutomationController,
            browserPreviewAutomationPage(record),
            input,
            signal,
          )
        }),
      ),
    scroll: (scope, input) =>
      withAgentAccess(
        browserPreviewAutomationPromiseEffect((signal) => {
          const record = requireBrowserPreviewAutomationRecord(scope, input)
          return scrollBrowserPreviewPage(
            browserPreviewAutomationController,
            browserPreviewAutomationPage(record),
            input,
            signal,
          )
        }),
      ),
    evaluate: (scope, input) =>
      withAgentAccess(
        browserPreviewAutomationPromiseEffect((signal) => {
          const record = requireBrowserPreviewAutomationRecord(scope, input)
          return evaluateBrowserPreviewPage(
            browserPreviewAutomationController,
            browserPreviewAutomationPage(record),
            input,
            signal,
          )
        }),
      ),
    waitFor: (scope, input) =>
      withAgentAccess(
        browserPreviewAutomationPromiseEffect((signal) => {
          const record = requireBrowserPreviewAutomationRecord(scope, input)
          return waitForBrowserPreviewPage(
            browserPreviewAutomationController,
            browserPreviewAutomationPage(record),
            input,
            signal,
          )
        }),
      ),
  }
}
