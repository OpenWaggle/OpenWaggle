import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { browserPreviewManager } from '../browser-preview'
import { navigateBrowserPreviewAndWait } from '../browser-preview-automation-navigation'
import {
  resolveBrowserPreviewAutomationNavigationUrl,
  resolveBrowserPreviewAutomationViewport,
  validateBrowserPreviewAutomationOpen,
  validateBrowserPreviewAutomationTimeout,
} from '../browser-preview-automation-validation'
import { browserPreviewOwnerRegistry } from '../browser-preview-owner-registry'
import type { BrowserPreviewAutomationServiceShape } from '../ports/browser-preview-automation-service'
import type { SettingsServiceShape } from '../services/settings-service'
import {
  type BrowserPreviewAutomationAccessGuard,
  browserPreviewAutomationDefaults,
  browserPreviewAutomationPromiseEffect,
  browserPreviewAutomationSyncEffect,
} from './electron-browser-preview-automation-effects'
import {
  browserPreviewAutomationOwnerKey,
  browserPreviewAutomationStatusFor,
  findBrowserPreviewAutomationRecord,
  requireBrowserPreviewAutomationRecord,
} from './electron-browser-preview-automation-records'

type BrowserPreviewAutomationLifecycleOperations = Pick<
  BrowserPreviewAutomationServiceShape,
  'status' | 'open' | 'navigate' | 'resize' | 'setAppearance'
>

export function makeBrowserPreviewAutomationLifecycleOperations(
  settings: SettingsServiceShape,
  withAgentAccess: BrowserPreviewAutomationAccessGuard,
): BrowserPreviewAutomationLifecycleOperations {
  return {
    status: (scope, input) =>
      withAgentAccess(
        Effect.sync(() =>
          browserPreviewAutomationStatusFor(findBrowserPreviewAutomationRecord(scope, input)),
        ),
      ),
    open: (scope, input) =>
      withAgentAccess(
        Effect.gen(function* () {
          const { target, url } = yield* browserPreviewAutomationSyncEffect(() => {
            const canonicalUrl = validateBrowserPreviewAutomationOpen(input)
            const existing = findBrowserPreviewAutomationRecord(scope, input)
            if (input.tabId !== undefined && !existing) {
              throw new Error(`Browser preview "${input.tabId}" was not found for this session.`)
            }
            const target = input.reuseExistingTab === false ? undefined : existing
            const url = canonicalUrl ?? target?.state.url
            if (!url) throw new Error('A URL is required to create the first browser preview.')
            return { target, url }
          })
          const defaults = yield* browserPreviewAutomationDefaults(settings)
          const profileId = target?.profileId ?? defaults.profileId
          const previewId = target?.previewId ?? `preview-${randomUUID()}`
          const visible = input.open ?? defaults.autoShow
          yield* browserPreviewAutomationPromiseEffect((signal) =>
            browserPreviewOwnerRegistry.requestOpen(
              {
                ownerKey: browserPreviewAutomationOwnerKey(scope),
                previewId,
                profileId,
                url,
                visible,
                // Visible automation opens live in the floating chat player. They must not
                // replace whichever terminal or browser the user kept in the right panel.
                activate: false,
              },
              { signal },
            ),
          )
          return yield* browserPreviewAutomationSyncEffect(() =>
            browserPreviewAutomationStatusFor(
              requireBrowserPreviewAutomationRecord(scope, { tabId: previewId }),
            ),
          )
        }),
      ),
    navigate: (scope, input) =>
      withAgentAccess(
        Effect.gen(function* () {
          const { url, timeoutMs } = yield* browserPreviewAutomationSyncEffect(() => ({
            url: resolveBrowserPreviewAutomationNavigationUrl(input),
            timeoutMs: validateBrowserPreviewAutomationTimeout(input.timeoutMs),
          }))
          return yield* browserPreviewAutomationPromiseEffect(async (signal) => {
            const record = requireBrowserPreviewAutomationRecord(scope, input)
            await navigateBrowserPreviewAndWait({
              contents: record.view.webContents,
              url,
              readiness: input.readiness ?? 'load',
              timeoutMs,
              signal,
              navigate: () =>
                browserPreviewManager.beginAutomationNavigation(
                  record.owner.sender,
                  record.previewId,
                  url,
                ),
            })
            return browserPreviewAutomationStatusFor(record)
          })
        }),
      ),
    resize: (scope, input) =>
      withAgentAccess(
        browserPreviewAutomationSyncEffect(() => {
          const record = requireBrowserPreviewAutomationRecord(scope, input)
          const viewport = resolveBrowserPreviewAutomationViewport(input)
          browserPreviewManager.setViewport(record.owner.sender, record.previewId, viewport)
          return { tabId: record.previewId, viewport }
        }),
      ),
    setAppearance: (scope, input) =>
      withAgentAccess(
        browserPreviewAutomationPromiseEffect(async () => {
          const record = requireBrowserPreviewAutomationRecord(scope, input)
          await browserPreviewManager.setAppearance(
            record.owner.sender,
            record.previewId,
            input.colorScheme,
          )
          return { tabId: record.previewId, colorScheme: input.colorScheme }
        }),
      ),
  }
}
