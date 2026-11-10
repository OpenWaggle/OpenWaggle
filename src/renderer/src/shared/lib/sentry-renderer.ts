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
  captureException,
  dedupeIntegration,
  type Event,
  type EventHint,
  eventFiltersIntegration,
  globalHandlersIntegration,
  init,
  linkedErrorsIntegration,
} from '@sentry/electron/renderer'
import {
  ERROR_REPORT_API_METHOD_TAG,
  errorReportingDataCollection,
} from '@shared/error-reporting/error-report-constants'
import { scrubErrorReportEvent } from '@shared/error-reporting/error-report-scrubbing'
import { rejectedApiMethodOf } from './ipc'

/**
 * Drops what the renderer must not hand over. The text rules wait for the main process, which
 * knows the home directory and applies them to every renderer report before sending it.
 */
function scrubbed<Report extends Event>(event: Report, hint: EventHint): Report {
  const rejectedMethod = rejectedApiMethodOf(hint.originalException)
  if (rejectedMethod !== undefined) {
    // A method name is the bridge's own, so no text rule needs to drop it, and scrubbing keeps
    // tags: this is how a stackless IPC rejection still says which call failed.
    event.tags = { ...event.tags, [ERROR_REPORT_API_METHOD_TAG]: rejectedMethod }
  }
  scrubErrorReportEvent(event, { originalException: hint.originalException, scrubText: false })
  return event
}

/** The renderer SDK's own options type; it leaves out the main-process-only `dsn`. */
type SentryRendererOptions = NonNullable<Parameters<typeof init>[0]>

/** The complete Sentry options for the renderer. Release and environment come from main. */
export function createSentryRendererOptions(): SentryRendererOptions {
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
