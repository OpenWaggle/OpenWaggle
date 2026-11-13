import { randomUUID } from 'node:crypto'
import type {
  BrowserPreviewAutomationRecordingArtifact,
  BrowserPreviewAutomationStatus,
  BrowserPreviewAutomationTarget,
} from '@shared/types/browser-preview-automation'
import type {
  BrowserPreviewAppearance,
  BrowserPreviewViewport,
} from '@shared/types/browser-preview-controls'
import type { BrowserPreviewState } from '@shared/types/browser-preview'
import { Effect } from 'effect'
import type { BrowserPreviewAutomationPage } from './browser-preview-automation-contents'
import { browserPreviewAutomationController } from './browser-preview-automation-control'
import {
  type BrowserPreviewAutomationAccessGuard,
  browserPreviewAutomationDefaults,
  browserPreviewAutomationPromiseEffect,
  browserPreviewAutomationSyncEffect,
  createBrowserPreviewAutomationAccessGuard,
} from './browser-preview-automation-effects'
import {
  clickBrowserPreviewPage,
  evaluateBrowserPreviewPage,
  pressBrowserPreviewKey,
  scrollBrowserPreviewPage,
  typeIntoBrowserPreviewPage,
  waitForBrowserPreviewPage,
} from './browser-preview-automation-page-actions'
import { captureBrowserPreviewAutomationSnapshot } from './browser-preview-automation-snapshot'
import {
  resolveBrowserPreviewAutomationNavigationUrl,
  resolveBrowserPreviewAutomationViewport,
  validateBrowserPreviewAutomationOpen,
  validateBrowserPreviewAutomationTimeout,
} from './browser-preview-automation-validation'
import type {
  BrowserPreviewAutomationScope,
  BrowserPreviewAutomationServiceShape,
} from '../../../ports/browser-preview-automation-service'
import type { SettingsServiceShape } from '../../../services/settings-service'

/** What the automation reads of one preview tab. */
export interface BrowserPreviewAutomationTab {
  readonly previewId: string
  readonly profileId: string
  readonly state: BrowserPreviewState
  readonly bounds: unknown
  readonly disposed: boolean
}

export type BrowserPreviewNavigationReadiness = 'load' | 'domContentLoaded' | 'none'

export interface BrowserPreviewAutomationNavigation {
  readonly url: string
  readonly readiness: BrowserPreviewNavigationReadiness
  readonly timeoutMs: number
  readonly signal: AbortSignal
}

/** A preview open the agent asked for, which the owner page materializes. */
export interface BrowserPreviewAutomationOpenRequest {
  readonly ownerKey: string
  readonly previewId: string
  readonly profileId: string
  readonly url: string
  readonly visible: boolean
  readonly activate: boolean
}

/**
 * The desktop shell's side of Browser preview automation (ADR 0064): its preview tabs, the page
 * each one is to the automation controller, and the shell operations the agent's tools reach.
 */
export interface BrowserPreviewAutomationShell<Tab extends BrowserPreviewAutomationTab> {
  readonly findTab: (ownerKey: string, tabId?: string) => Tab | undefined
  /** Makes `tab` its owner's current preview, as an agent addressing a tab by id does. */
  readonly selectTab: (tab: Tab, ownerKey: string) => void
  readonly page: (tab: Tab) => BrowserPreviewAutomationPage
  readonly requestOpen: (
    request: BrowserPreviewAutomationOpenRequest,
    options: { readonly signal: AbortSignal },
  ) => Promise<unknown>
  readonly navigateAndWait: (
    tab: Tab,
    navigation: BrowserPreviewAutomationNavigation,
  ) => Promise<void>
  readonly setViewport: (tab: Tab, viewport: BrowserPreviewViewport) => void
  readonly setAppearance: (tab: Tab, appearance: BrowserPreviewAppearance) => Promise<void>
  readonly startRecording: (tab: Tab, options: { readonly signal: AbortSignal }) => Promise<void>
  readonly stopRecording: (
    tab: Tab,
    options: { readonly signal: AbortSignal },
  ) => Promise<Omit<BrowserPreviewAutomationRecordingArtifact, 'tabId'>>
}

export function browserPreviewAutomationOwnerKey(scope: BrowserPreviewAutomationScope) {
  return String(scope.sessionId)
}

export function browserPreviewAutomationStatusFor(tab?: BrowserPreviewAutomationTab) {
  if (!tab || tab.disposed) {
    return {
      available: false,
      visible: false,
      tabId: null,
      url: null,
      title: null,
      loading: false,
      viewport: null,
      appearance: null,
    } satisfies BrowserPreviewAutomationStatus
  }
  return {
    available: true,
    visible: tab.bounds !== null,
    tabId: tab.previewId,
    url: tab.state.url,
    title: tab.state.title,
    loading: tab.state.loading,
    viewport: tab.state.controls.viewport,
    appearance: tab.state.controls.appearance,
  } satisfies BrowserPreviewAutomationStatus
}

function tabs<Tab extends BrowserPreviewAutomationTab>(shell: BrowserPreviewAutomationShell<Tab>) {
  const find = (scope: BrowserPreviewAutomationScope, target: BrowserPreviewAutomationTarget) =>
    shell.findTab(browserPreviewAutomationOwnerKey(scope), target.tabId)
  const require = (
    scope: BrowserPreviewAutomationScope,
    target: BrowserPreviewAutomationTarget,
  ) => {
    const tab = find(scope, target)
    if (tab) {
      if (target.tabId !== undefined) shell.selectTab(tab, browserPreviewAutomationOwnerKey(scope))
      return tab
    }
    throw new Error(
      target.tabId
        ? `Browser preview "${target.tabId}" was not found for this session.`
        : 'This session does not have a current browser preview.',
    )
  }
  return { find, require }
}

function lifecycleOperations<Tab extends BrowserPreviewAutomationTab>(
  settings: SettingsServiceShape,
  withAgentAccess: BrowserPreviewAutomationAccessGuard,
  shell: BrowserPreviewAutomationShell<Tab>,
) {
  const { find, require } = tabs(shell)
  return {
    status: (scope, input) =>
      withAgentAccess(Effect.sync(() => browserPreviewAutomationStatusFor(find(scope, input)))),
    open: (scope, input) =>
      withAgentAccess(
        Effect.gen(function* () {
          const { target, url } = yield* browserPreviewAutomationSyncEffect(() => {
            const canonicalUrl = validateBrowserPreviewAutomationOpen(input)
            const existing = find(scope, input)
            if (input.tabId !== undefined && !existing) {
              throw new Error(`Browser preview "${input.tabId}" was not found for this session.`)
            }
            const target = input.reuseExistingTab === false ? undefined : existing
            const url = canonicalUrl ?? target?.state.url
            if (!url) throw new Error('A URL is required to create the first browser preview.')
            return { target, url }
          })
          const defaults = yield* browserPreviewAutomationDefaults(settings)
          const previewId = target?.previewId ?? `preview-${randomUUID()}`
          yield* browserPreviewAutomationPromiseEffect((signal) =>
            shell.requestOpen(
              {
                ownerKey: browserPreviewAutomationOwnerKey(scope),
                previewId,
                profileId: target?.profileId ?? defaults.profileId,
                url,
                visible: input.open ?? defaults.autoShow,
                // Visible automation opens live in the floating chat player. They must not
                // replace whichever terminal or browser the user kept in the right panel.
                activate: false,
              },
              { signal },
            ),
          )
          return yield* browserPreviewAutomationSyncEffect(() =>
            browserPreviewAutomationStatusFor(require(scope, { tabId: previewId })),
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
            const tab = require(scope, input)
            const readiness = input.readiness ?? 'load'
            await shell.navigateAndWait(tab, { url, readiness, timeoutMs, signal })
            return browserPreviewAutomationStatusFor(tab)
          })
        }),
      ),
    resize: (scope, input) =>
      withAgentAccess(
        browserPreviewAutomationSyncEffect(() => {
          const tab = require(scope, input)
          const viewport = resolveBrowserPreviewAutomationViewport(input)
          shell.setViewport(tab, viewport)
          return { tabId: tab.previewId, viewport }
        }),
      ),
    setAppearance: (scope, input) =>
      withAgentAccess(
        browserPreviewAutomationPromiseEffect(async () => {
          const tab = require(scope, input)
          await shell.setAppearance(tab, input.colorScheme)
          return { tabId: tab.previewId, colorScheme: input.colorScheme }
        }),
      ),
  } satisfies Pick<
    BrowserPreviewAutomationServiceShape,
    'status' | 'open' | 'navigate' | 'resize' | 'setAppearance'
  >
}

function pageOperations<Tab extends BrowserPreviewAutomationTab>(
  withAgentAccess: BrowserPreviewAutomationAccessGuard,
  shell: BrowserPreviewAutomationShell<Tab>,
) {
  const { require } = tabs(shell)
  const controller = browserPreviewAutomationController
  const onPage =
    <Input extends BrowserPreviewAutomationTarget, A>(
      action: (page: BrowserPreviewAutomationPage, input: Input, signal: AbortSignal) => Promise<A>,
    ) =>
    (scope: BrowserPreviewAutomationScope, input: Input) =>
      withAgentAccess(
        browserPreviewAutomationPromiseEffect((signal) =>
          action(shell.page(require(scope, input)), input, signal),
        ),
      )
  return {
    snapshot: onPage((page, _input, signal) =>
      captureBrowserPreviewAutomationSnapshot(controller, page, signal),
    ),
    click: onPage((page, input, signal) =>
      clickBrowserPreviewPage(controller, page, input, signal),
    ),
    type: onPage((page, input, signal) =>
      typeIntoBrowserPreviewPage(controller, page, input, signal),
    ),
    press: onPage((page, input, signal) => pressBrowserPreviewKey(controller, page, input, signal)),
    scroll: onPage((page, input, signal) =>
      scrollBrowserPreviewPage(controller, page, input, signal),
    ),
    evaluate: onPage((page, input, signal) =>
      evaluateBrowserPreviewPage(controller, page, input, signal),
    ),
    waitFor: onPage((page, input, signal) =>
      waitForBrowserPreviewPage(controller, page, input, signal),
    ),
  } satisfies Pick<
    BrowserPreviewAutomationServiceShape,
    'snapshot' | 'click' | 'type' | 'press' | 'scroll' | 'evaluate' | 'waitFor'
  >
}

function recordingOperations<Tab extends BrowserPreviewAutomationTab>(
  withAgentAccess: BrowserPreviewAutomationAccessGuard,
  shell: BrowserPreviewAutomationShell<Tab>,
) {
  const { require } = tabs(shell)
  return {
    startRecording: (scope, input) =>
      withAgentAccess(
        browserPreviewAutomationPromiseEffect(async (signal) => {
          const tab = require(scope, input)
          await shell.startRecording(tab, { signal })
          return { tabId: tab.previewId, recording: true, startedAt: new Date().toISOString() }
        }),
      ),
    stopRecording: (scope, input) =>
      withAgentAccess(
        browserPreviewAutomationPromiseEffect(async (signal) => {
          const tab = require(scope, input)
          const artifact = await shell.stopRecording(tab, { signal })
          return { ...artifact, tabId: tab.previewId }
        }),
      ),
  } satisfies Pick<BrowserPreviewAutomationServiceShape, 'startRecording' | 'stopRecording'>
}

/** The agent's Browser preview tools over one desktop shell's previews. */
export function makeBrowserPreviewAutomationService<Tab extends BrowserPreviewAutomationTab>(
  settings: SettingsServiceShape,
  shell: BrowserPreviewAutomationShell<Tab>,
) {
  const withAgentAccess = createBrowserPreviewAutomationAccessGuard(settings)
  return {
    ...lifecycleOperations(settings, withAgentAccess, shell),
    ...pageOperations(withAgentAccess, shell),
    ...recordingOperations(withAgentAccess, shell),
  } satisfies BrowserPreviewAutomationServiceShape
}
