/**
 * Sentry adapter for the renderer (ADR 0045). Loaded as its own chunk, and only when the main
 * process reports errors, so the SDK is never part of the initial renderer graph.
 *
 * Reports travel over the preload's IPC bridge to the main process, which scrubs them again with
 * every text rule, drops them while Usage statistics are off and sends the rest through the
 * OpenWaggle endpoint. An error the renderer reports keeps only its type and code.
 * Breadcrumbs, sessions, tracing, replay and request data are off: `defaultIntegrations` is off and
 * only uncaught errors, unhandled rejections and errors reported by the app are captured.
 */

import {
  type BrowserOptions,
  captureException,
  dedupeIntegration,
  type Event,
  type EventHint,
  eventFiltersIntegration,
  globalHandlersIntegration,
  init,
  linkedErrorsIntegration,
} from '@sentry/electron/renderer'
import { errorReportingDataCollection } from '@shared/error-reporting/error-report-constants'
import { scrubErrorReportEvent } from '@shared/error-reporting/error-report-scrubbing'

/**
 * Drops what the renderer must not hand over. The text rules wait for the main process, which
 * knows the home directory and applies them to every renderer report before sending it.
 */
function scrubbed<Report extends Event>(event: Report, hint: EventHint) {
  scrubErrorReportEvent(event, { originalException: hint.originalException, scrubText: false })
  return event
}

/** The complete Sentry options for the renderer. Release and environment come from main. */
export function createSentryRendererOptions(): BrowserOptions {
  return {
    dataCollection: errorReportingDataCollection(),
    maxBreadcrumbs: 0,
    attachStacktrace: false,
    defaultIntegrations: false,
    integrations: [
      eventFiltersIntegration(),
      globalHandlersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
    ],
    beforeBreadcrumb: () => null,
    beforeSend: scrubbed,
    beforeSendTransaction: scrubbed,
  }
}

/** Initializes Sentry in this renderer and returns how the app reports a caught error. */
export function startSentryRendererErrorReporter() {
  init(createSentryRendererOptions())
  return {
    captureException: (error: unknown) => {
      captureException(error)
    },
  }
}
