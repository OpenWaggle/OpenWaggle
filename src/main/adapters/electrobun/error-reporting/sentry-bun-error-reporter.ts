/**
 * Sentry adapter for the Bun main processes of the Electrobun build: the GUI main process and the
 * Session Host (ADR 0045, 0064). Vendor imports stay in this directory.
 *
 * Only errors are reported. Breadcrumbs, release-health sessions, tracing, profiling, local
 * variables, source lines, console and network capture and child-process instrumentation are all
 * off, because `defaultIntegrations` is off and only the integrations below are installed. The
 * renderer's SDK (`@sentry/browser`) hands its envelopes to this process over the IPC channel
 * `error-reporting:renderer-envelope`; `captureRendererEnvelope` re-captures each error event here
 * so this process's scrubbing and gate apply to it. Every report is posted to the OpenWaggle endpoint through
 * `tunnel`, under a placeholder DSN the endpoint replaces. Nothing is sent while Usage statistics
 * are off: `beforeSend` drops the report, and the transport drops anything that still reaches it.
 */

import {
  type BunOptions,
  captureEvent,
  captureException,
  captureMessage,
  dedupeIntegration,
  type Event,
  type EventHint,
  eventFiltersIntegration,
  flush,
  init,
  linkedErrorsIntegration,
  onUncaughtExceptionIntegration,
  onUnhandledRejectionIntegration,
  rewriteFramesIntegration,
} from '@sentry/bun'
import {
  ERROR_REPORT_ORIGIN_TAG,
  ERROR_REPORTING_PLACEHOLDER_DSN,
  ERROR_REPORTING_TUNNEL_URL,
  errorReportingDataCollection,
  isErrorReportOrigin,
} from '@shared/error-reporting/error-report-constants'
import { scrubErrorReportEvent } from '@shared/error-reporting/error-report-scrubbing'
import { describeError } from '../../../error-description'
import { createLogger } from '../../../logger'
import type { ShellProcessExit } from '../../../ports/desktop-shell/system-integration'
import type { ErrorReporter, ErrorReportOrigin } from '../../../ports/error-reporter'
import { onProcessGone } from '../electrobun-shell-events'
import { rendererEnvelopeEvents } from './renderer-envelope'
import { createGatedFetchTransport } from './sentry-gated-transport'

const logger = createLogger('sentry-bun-error-reporter')

/** Tag naming the OpenWaggle process that reported an error. */
const PROCESS_TAG = 'openwaggle.process'
/**
 * Event hint data naming the origin this adapter reported an error with. It is the only source
 * of a report's origin tag: a renderer can set scope tags over the SDK's IPC bridge, and a hint
 * never crosses it.
 */
const REPORTED_ORIGIN_HINT_KEY = 'openwaggleReportedOrigin'
/** Tags naming a web engine process that ended and how it ended. */
const EXITED_PROCESS_TAG = 'openwaggle.exited_process'
const PROCESS_EXIT_TAG = 'openwaggle.process_exit'

/** How a renderer process may end that is reported as an error event. */
const REPORTED_PROCESS_EXITS: ReadonlySet<string> = new Set([
  'abnormal-exit',
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
])
const FATAL_PROCESS_EXITS: ReadonlySet<string> = new Set([
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
])

type SentryIntegration = Extract<
  NonNullable<BunOptions['integrations']>,
  readonly unknown[]
>[number]

export interface SentryBunErrorReporterInput {
  readonly process: 'gui' | 'session-host'
  readonly release: string
  readonly environment: string
  readonly homeDirectory: string
  readonly temporaryDirectory: string
  /** Whether a report may leave the machine right now. */
  readonly isEnabled: () => boolean
  readonly operatingSystem: { readonly name: string; readonly version: string }
  readonly arch: string
  /** The app's install directory; frames under it are reported as `app:///`. */
  readonly appRoot: string
}

type ProcessExitListener = (exitedProcess: string, reason: string) => void

function listenToWebEngineProcessExits(listener: ProcessExitListener) {
  onProcessGone((exit: ShellProcessExit) => listener(exit.process, exit.reason))
}

function reportProcessExit(exitedProcess: string, reason: string) {
  if (!REPORTED_PROCESS_EXITS.has(reason)) return
  // The message is dropped by scrubbing like any other; the tags and fingerprint keep the facts.
  captureMessage(`'${exitedProcess}' process exited with '${reason}'`, {
    level: FATAL_PROCESS_EXITS.has(reason) ? 'fatal' : 'warning',
    tags: { [EXITED_PROCESS_TAG]: exitedProcess, [PROCESS_EXIT_TAG]: reason },
    fingerprint: ['process-exit', exitedProcess, reason],
  })
}

/**
 * Reports a renderer the heartbeat found gone, by its process type and exit reason only. The
 * SDK's child-process integration would also instrument every child process and worker of the
 * app and report errors the app handles.
 */
export function processExitIntegration(
  listen: (listener: ProcessExitListener) => void = listenToWebEngineProcessExits,
) {
  return {
    name: 'OpenWaggleProcessExit',
    setupOnce() {
      listen(reportProcessExit)
    },
  } satisfies SentryIntegration
}

function reportedOrigin(hint: EventHint) {
  const data: unknown = hint.data
  const origin: unknown =
    typeof data === 'object' && data !== null
      ? Reflect.get(data, REPORTED_ORIGIN_HINT_KEY)
      : undefined
  return isErrorReportOrigin(origin) ? origin : undefined
}

/**
 * Replaces any origin tag with the one this adapter's own capture gave, or removes it. An
 * `application` origin keeps the message text, so a tag from the scope, which a renderer page can
 * set, or from a renderer's own report must never count.
 */
function keepReportedOriginOnly(event: Event, hint: EventHint) {
  if (event.tags) delete event.tags[ERROR_REPORT_ORIGIN_TAG]
  const origin = reportedOrigin(hint)
  if (origin) event.tags = { ...event.tags, [ERROR_REPORT_ORIGIN_TAG]: origin }
}

function scrubbedWhileEnabled<Report extends Event>(
  input: SentryBunErrorReporterInput,
  scrubbed: WeakSet<object>,
) {
  return (event: Report, hint: EventHint) => {
    if (!input.isEnabled()) return null
    keepReportedOriginOnly(event, hint)
    scrubErrorReportEvent(event, {
      homeDirectory: input.homeDirectory,
      temporaryDirectory: input.temporaryDirectory,
      originalException: hint.originalException,
    })
    scrubbed.add(event)
    return event
  }
}

/** The complete Sentry options for a main process. */
export function createSentryMainOptions(input: SentryBunErrorReporterInput) {
  // The events `beforeSend` scrubbed; the transport sends no other event.
  const scrubbed = new WeakSet<object>()
  const wasScrubbed = (event: unknown) =>
    typeof event === 'object' && event !== null && scrubbed.has(event)
  const options: BunOptions = {
    dsn: ERROR_REPORTING_PLACEHOLDER_DSN,
    tunnel: ERROR_REPORTING_TUNNEL_URL,
    release: input.release,
    environment: input.environment,
    // Replaces the deprecated `sendDefaultPii: false`, and also turns off IP inference.
    dataCollection: errorReportingDataCollection(),
    sendClientReports: false,
    maxBreadcrumbs: 0,
    attachStacktrace: false,
    enableLogs: false,
    // Tracing is off, so Sentry's OpenTelemetry tracer, propagator and context manager stay out.
    skipOpenTelemetrySetup: true,
    defaultIntegrations: false,
    integrations: [
      eventFiltersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
      onUncaughtExceptionIntegration(),
      onUnhandledRejectionIntegration({ mode: 'warn' }),
      processExitIntegration(),
      // Runs last so the app path in every frame is already normalized to `app:///`.
      rewriteFramesIntegration({ root: input.appRoot, prefix: 'app:///' }),
    ],
    initialScope: {
      tags: { [PROCESS_TAG]: input.process },
      contexts: {
        os: { name: input.operatingSystem.name, version: input.operatingSystem.version },
        device: { arch: input.arch },
      },
    },
    transport: createGatedFetchTransport(input.isEnabled, wasScrubbed),
    beforeBreadcrumb: () => null,
    beforeSend: scrubbedWhileEnabled(input, scrubbed),
    beforeSendTransaction: scrubbedWhileEnabled(input, scrubbed),
  }
  return options
}

/** Waits for the SDK's flush, which can take up to twice its timeout, for `timeoutMs` at most. */
async function flushWithin(timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
  })
  try {
    await Promise.race([flush(timeoutMs), deadline])
  } finally {
    clearTimeout(timer)
  }
}

/** Initializes Sentry in this main process and returns the error reporting port. */
export function startSentryMainErrorReporter(input: SentryBunErrorReporterInput) {
  init(createSentryMainOptions(input))
  return {
    captureException: (error: unknown, origin?: ErrorReportOrigin) => {
      try {
        captureException(error, origin ? { data: { [REPORTED_ORIGIN_HINT_KEY]: origin } } : {})
      } catch (captureError) {
        logger.warn('Could not record an error report', describeError(captureError))
      }
    },
    captureRendererEnvelope: (envelope: string) => {
      try {
        // No hint: a renderer's event never carries an origin, so it keeps only type and code.
        for (const event of rendererEnvelopeEvents(envelope)) captureEvent(event)
      } catch (captureError) {
        logger.warn('Could not record a renderer error report', describeError(captureError))
      }
    },
    flush: async (timeoutMs) => {
      try {
        await flushWithin(timeoutMs)
      } catch (flushError) {
        logger.warn('Pending error reports were not sent', describeError(flushError))
      }
    },
  } satisfies ErrorReporter
}
