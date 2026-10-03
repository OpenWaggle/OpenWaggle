/**
 * Sentry adapter for the Electron main process: the GUI main process and the Session Host
 * (ADR 0045). Vendor imports stay in this directory.
 *
 * Only errors are reported. Breadcrumbs, release-health sessions, tracing, profiling, screenshots,
 * local variables, source lines, console and network capture, child-process instrumentation and
 * native crash dump upload are all off, because `defaultIntegrations` is off and only the
 * integrations below are installed. Every report is posted to the OpenWaggle endpoint through
 * `tunnel`, under a placeholder DSN the endpoint replaces. Nothing is sent while Usage statistics
 * are off: `beforeSend` drops the report, and the transport drops anything that still reaches it.
 */

import {
  captureException,
  captureMessage,
  dedupeIntegration,
  type ElectronMainOptions,
  type Event,
  type EventHint,
  electronContextIntegration,
  eventFiltersIntegration,
  flush,
  IPCMode,
  init,
  linkedErrorsIntegration,
  normalizePathsIntegration,
  onUncaughtExceptionIntegration,
  onUnhandledRejectionIntegration,
} from '@sentry/electron/main'
import {
  ERROR_REPORT_ORIGIN_TAG,
  ERROR_REPORTING_PLACEHOLDER_DSN,
  ERROR_REPORTING_TUNNEL_URL,
  errorReportingDataCollection,
  isErrorReportOrigin,
} from '@shared/error-reporting/error-report-constants'
import { scrubErrorReportEvent } from '@shared/error-reporting/error-report-scrubbing'
import { app, ipcMain } from 'electron'
import { describeError } from '../../error-description'
import { createLogger } from '../../logger'
import type { ErrorReporter, ErrorReportOrigin } from '../../ports/error-reporter'
import { createGatedElectronTransport } from './sentry-gated-transport'

const logger = createLogger('sentry-main-error-reporter')

/** Tag naming the OpenWaggle process that reported an error. */
const PROCESS_TAG = 'openwaggle.process'
/**
 * Event hint data naming the origin this adapter reported an error with. It is the only source
 * of a report's origin tag: a renderer can set scope tags over the SDK's IPC bridge, and a hint
 * never crosses it.
 */
const REPORTED_ORIGIN_HINT_KEY = 'openwaggleReportedOrigin'
/**
 * The SDK's IPC channel on which a renderer sets this process's scope: its default namespace,
 * `sentry-ipc`, and the `scope` channel. Only the SDK's scope-to-main integration uses it, which
 * the renderer leaves out with the other default integrations.
 */
const RENDERER_SCOPE_CHANNEL = 'sentry-ipc.scope'
/** Tags naming an Electron helper process that ended and how it ended. */
const EXITED_PROCESS_TAG = 'openwaggle.exited_process'
const PROCESS_EXIT_TAG = 'openwaggle.process_exit'

/** How an Electron child or renderer process may end that is reported as an error event. */
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
  NonNullable<ElectronMainOptions['integrations']>,
  readonly unknown[]
>[number]

export interface SentryMainErrorReporterInput {
  readonly process: 'gui' | 'session-host'
  readonly release: string
  readonly environment: string
  readonly homeDirectory: string
  readonly temporaryDirectory: string
  /** Whether a report may leave the machine right now. */
  readonly isEnabled: () => boolean
  readonly operatingSystem: { readonly name: string; readonly version: string }
  readonly arch: string
}

type ProcessExitListener = (exitedProcess: string, reason: string) => void

function listenToElectronProcessExits(listener: ProcessExitListener) {
  app.on('child-process-gone', (_event, details) => listener(details.type, details.reason))
  app.on('render-process-gone', (_event, _contents, details) =>
    listener('renderer', details.reason),
  )
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
 * Reports an Electron child or renderer process that ended abnormally, by its process type and
 * exit reason only. It replaces the SDK's child-process integration, which also instruments every
 * Node.js child process and worker thread of the app and reports errors the app handles.
 */
export function processExitIntegration(
  listen: (listener: ProcessExitListener) => void = listenToElectronProcessExits,
): SentryIntegration {
  return {
    name: 'OpenWaggleProcessExit',
    setupOnce() {
      listen(reportProcessExit)
    },
  }
}

function reportedOrigin(hint: EventHint): ErrorReportOrigin | undefined {
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
  input: SentryMainErrorReporterInput,
  scrubbed: WeakSet<object>,
) {
  return (event: Report, hint: EventHint): Report | null => {
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
export function createSentryMainOptions(input: SentryMainErrorReporterInput): ElectronMainOptions {
  // The events `beforeSend` scrubbed; the transport sends no other event.
  const scrubbed = new WeakSet<object>()
  const wasScrubbed = (event: unknown) =>
    typeof event === 'object' && event !== null && scrubbed.has(event)
  return {
    dsn: ERROR_REPORTING_PLACEHOLDER_DSN,
    tunnel: ERROR_REPORTING_TUNNEL_URL,
    release: input.release,
    environment: input.environment,
    // Replaces the deprecated `sendDefaultPii: false`, and also turns off IP inference.
    dataCollection: errorReportingDataCollection(),
    sendClientReports: false,
    maxBreadcrumbs: 0,
    attachStacktrace: false,
    attachScreenshot: false,
    enableRendererProfiling: false,
    includeLocalVariables: false,
    enableLogs: false,
    // Tracing is off, so Sentry's OpenTelemetry tracer, propagator and context manager stay out.
    skipOpenTelemetrySetup: true,
    // Renderers reach the main process over the preload's IPC bridge, never a custom protocol.
    ipcMode: IPCMode.Classic,
    defaultIntegrations: false,
    integrations: [
      eventFiltersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
      onUncaughtExceptionIntegration(),
      onUnhandledRejectionIntegration({ mode: 'warn' }),
      processExitIntegration(),
      electronContextIntegration(),
      // Runs last so the app path in every frame is already normalized to `app:///`.
      normalizePathsIntegration(),
    ],
    initialScope: {
      tags: { [PROCESS_TAG]: input.process },
      contexts: {
        os: { name: input.operatingSystem.name, version: input.operatingSystem.version },
        device: { arch: input.arch },
      },
    },
    transport: createGatedElectronTransport(input.isEnabled, wasScrubbed),
    beforeBreadcrumb: () => null,
    beforeSend: scrubbedWhileEnabled(input, scrubbed),
    beforeSendTransaction: scrubbedWhileEnabled(input, scrubbed),
  }
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
export function startSentryMainErrorReporter(input: SentryMainErrorReporterInput): ErrorReporter {
  init(createSentryMainOptions(input))
  // A page script could otherwise set tags, extras, the user or attachments on every report.
  ipcMain.removeAllListeners(RENDERER_SCOPE_CHANNEL)
  return {
    captureException: (error: unknown, origin?: ErrorReportOrigin) => {
      try {
        captureException(error, origin ? { data: { [REPORTED_ORIGIN_HINT_KEY]: origin } } : {})
      } catch (captureError) {
        logger.warn('Could not record an error report', describeError(captureError))
      }
    },
    flush: async (timeoutMs) => {
      try {
        await flushWithin(timeoutMs)
      } catch (flushError) {
        logger.warn('Pending error reports were not sent', describeError(flushError))
      }
    },
  }
}
