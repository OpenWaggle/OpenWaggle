/**
 * Sentry adapter for the renderer (ADR 0045, 0064). Loaded as its own chunk, and only when the main
 * process reports errors, so the SDK is never part of the initial renderer graph.
 *
 * Reports travel to the main process, which scrubs them again with every text rule, drops them
 * while Usage statistics are off and sends the rest through the OpenWaggle endpoint. How they
 * travel depends on the desktop shell, which the preload tells by the bridge it defines:
 * - Electron (`__SENTRY_IPC__`): the Sentry Electron renderer SDK over its own preload bridge.
 * - Electrobun (`ERROR_REPORT_ENVELOPE_BRIDGE_GLOBAL`): the browser SDK, whose transport hands
 *   each serialized envelope to `window.api.sendErrorReportEnvelope`; the main process re-captures
 *   its error events (`ErrorReporter.captureRendererEnvelope`). Its page URLs are loopback URLs
 *   with a capability path, so its frames are rewritten to Electron's renderer origin first.
 *
 * An error the renderer reports keeps only its type and code. Breadcrumbs, sessions, tracing,
 * replay, client reports and request data are off: `defaultIntegrations` is off and only uncaught
 * errors, unhandled rejections and errors reported by the app are captured. Both shells share one
 * options policy (`createSentryRendererOptions`); the Electron SDK is the browser SDK underneath.
 */

import {
  type BrowserOptions,
  captureException,
  createTransport,
  dedupeIntegration,
  type Event,
  type EventHint,
  eventFiltersIntegration,
  globalHandlersIntegration,
  init as initBrowser,
  linkedErrorsIntegration,
  rewriteFramesIntegration,
} from '@sentry/browser'
import { init as initElectronRenderer } from '@sentry/electron/renderer'
import { RENDERER_CODE_LOCATION_PREFIX } from '@shared/error-reporting/error-report-code-rules'
import {
  ERROR_REPORT_API_METHOD_TAG,
  ERROR_REPORTING_PLACEHOLDER_DSN,
  errorReportingDataCollection,
} from '@shared/error-reporting/error-report-constants'
import { scrubErrorReportEvent } from '@shared/error-reporting/error-report-scrubbing'
import { api, rejectedApiMethodOf } from './ipc'

/** How this window hands reports to the main process, from the bridge its preload defined. */
export type RendererErrorReportingBridge = 'sentry-ipc' | 'renderer-envelope'

/**
 * Drops what the renderer must not hand over. The text rules wait for the main process, which
 * knows the home directory and applies them to every renderer report before sending it.
 */
function scrubbed<Report extends Event>(event: Report, hint: EventHint) {
  const rejectedMethod = rejectedApiMethodOf(hint.originalException)
  if (rejectedMethod !== undefined) {
    // A method name is the bridge's own, so no text rule needs to drop it, and scrubbing keeps
    // tags: this is how a stackless IPC rejection still says which call failed.
    event.tags = { ...event.tags, [ERROR_REPORT_API_METHOD_TAG]: rejectedMethod }
  }
  scrubErrorReportEvent(event, { originalException: hint.originalException, scrubText: false })
  return event
}

/** Only what captures errors: uncaught errors, unhandled rejections and their causes. */
function errorCaptureIntegrations() {
  return [
    eventFiltersIntegration(),
    globalHandlersIntegration(),
    linkedErrorsIntegration(),
    dedupeIntegration(),
  ]
}

/**
 * The renderer options both shells share. Release and environment come from main, and the
 * main-process-only `dsn` is left out: Electron's SDK sets its own placeholder.
 */
type SharedRendererOptions = Omit<BrowserOptions, 'dsn' | 'environment' | 'release'>

/** The complete Sentry options for the renderer, the policy both shells' SDKs start with. */
export function createSentryRendererOptions() {
  const options: SharedRendererOptions = {
    dataCollection: errorReportingDataCollection(),
    maxBreadcrumbs: 0,
    attachStacktrace: false,
    defaultIntegrations: false,
    integrations: errorCaptureIntegrations(),
    beforeBreadcrumb: () => null,
    beforeSend: scrubbed,
    beforeSendTransaction: scrubbed,
  }
  return options
}

type BrowserTransport = NonNullable<BrowserOptions['transport']>

/** Hands each envelope to the main process, which sends it; nothing here touches the network. */
function envelopeTransport(send: (envelope: string) => void): BrowserTransport {
  const decoder = new TextDecoder()
  return (options) =>
    createTransport(options, (request) => {
      send(typeof request.body === 'string' ? request.body : decoder.decode(request.body))
      // The main process applies rate limits and Usage statistics; the renderer never retries.
      return Promise.resolve({})
    })
}

/**
 * Names the page's own code as Electron's renderer origin does, `openwaggle://app/assets/…`, so the
 * report rules keep it as app code and no report carries the loopback port or capability path.
 */
function rendererFramesIntegration(documentUrl: string) {
  const pageBase = new URL('./', documentUrl).href
  return rewriteFramesIntegration({
    iteratee: (frame) => {
      if (frame.filename?.startsWith(pageBase)) {
        frame.filename = `${RENDERER_CODE_LOCATION_PREFIX}${frame.filename.slice(pageBase.length)}`
      }
      return frame
    },
  })
}

/** The browser SDK's options on Electrobun: the shared policy over the envelope transport. */
export function createSentryBrowserRendererOptions(input: {
  readonly documentUrl: string
  readonly send: (envelope: string) => void
}): BrowserOptions {
  return {
    ...createSentryRendererOptions(),
    // The browser SDK starts no transport without a DSN; the main process never reads this one.
    dsn: ERROR_REPORTING_PLACEHOLDER_DSN,
    sendClientReports: false,
    transport: envelopeTransport(input.send),
    integrations: [...errorCaptureIntegrations(), rendererFramesIntegration(input.documentUrl)],
  }
}

/** Initializes Sentry in this renderer and returns how the app reports a caught error. */
export function startSentryRendererErrorReporter(bridge: RendererErrorReportingBridge) {
  if (bridge === 'sentry-ipc') {
    initElectronRenderer(createSentryRendererOptions())
  } else {
    initBrowser(
      createSentryBrowserRendererOptions({
        documentUrl: window.location.href,
        send: (envelope) => api.sendErrorReportEnvelope(envelope),
      }),
    )
  }
  return {
    captureException: (error: unknown) => {
      captureException(error)
    },
  }
}
