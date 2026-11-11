/**
 * Renderer error reporting (ADR 0045).
 *
 * The SDK can start only when the main process reports errors, which it signals by having the
 * preload expose a bridge: the Sentry Electron SDK's IPC bridge on Electron, the envelope bridge on
 * Electrobun (ADR 0064), which also picks the SDK the chunk starts. Dev builds, automation and the
 * environment opt-outs never get a bridge. It then starts once this window's Settings have Usage statistics on, now or
 * when the user turns them on later, at the next idle moment. The SDK is a separate chunk, so it
 * stays off the startup path, and off entirely while statistics stay off.
 */
import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import { ERROR_REPORT_ENVELOPE_BRIDGE_GLOBAL } from '@shared/error-reporting/error-report-constants'
import { createRendererLogger } from './logger'
import type { RendererErrorReportingBridge } from './sentry-renderer'

interface RendererErrorReporter {
  readonly captureException: (error: unknown) => void
}

interface RendererErrorReporterModule {
  readonly startSentryRendererErrorReporter: (
    bridge: RendererErrorReportingBridge,
  ) => RendererErrorReporter
}

/** This window's view of the Usage statistics Setting. */
export interface RendererUsageStatistics {
  /** Whether the loaded Settings have Usage statistics on; `false` until they load. */
  readonly isEnabled: () => boolean
  /** Calls `listener` after a change that may flip {@link isEnabled}; returns the unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void
}

type ReportingState =
  | { readonly kind: 'off' }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'pending'; readonly pending: unknown[] }
  | { readonly kind: 'on'; readonly reporter: RendererErrorReporter }

/** Global the Sentry Electron preload bridge defines when the main process reports errors. */
const SENTRY_IPC_BRIDGE_GLOBAL = '__SENTRY_IPC__'
/** Errors the app reports while the SDK is about to start; later ones are dropped. */
const MAX_PENDING_ERRORS = 10
/** The SDK starts by then even if the renderer never goes idle. */
const IDLE_START_TIMEOUT_MS = 5_000

const logger = createRendererLogger('error-reporting')
let state: ReportingState = { kind: 'off' }

/** The bridge this window's preload defined, or null when the main process reports no errors. */
function errorReportingBridge(): RendererErrorReportingBridge | null {
  if (typeof window === 'undefined') return null
  if (Reflect.has(window, SENTRY_IPC_BRIDGE_GLOBAL)) return 'sentry-ipc'
  if (Reflect.has(window, ERROR_REPORT_ENVELOPE_BRIDGE_GLOBAL)) return 'renderer-envelope'
  return null
}

function importSentryRendererErrorReporter() {
  return import('./sentry-renderer')
}

function whenIdle(start: () => void) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(start, { timeout: IDLE_START_TIMEOUT_MS })
    return
  }
  setTimeout(start, 0)
}

function startReporter(
  bridge: RendererErrorReportingBridge,
  pending: unknown[],
  loadReporter: () => Promise<RendererErrorReporterModule>,
) {
  loadReporter().then(
    ({ startSentryRendererErrorReporter }) => {
      const reporter = startSentryRendererErrorReporter(bridge)
      state = { kind: 'on', reporter }
      for (const error of pending) reporter.captureException(error)
    },
    (error: unknown) => {
      state = { kind: 'off' }
      logger.warn('Error reporting did not start', {
        error: error instanceof Error ? error.message : String(error),
      })
    },
  )
}

/**
 * Starts renderer error reporting at the next idle moment once Usage statistics are on, when the
 * main process reports errors. Safe to call once. Errors the app reports while statistics are
 * off are dropped, never held for later.
 */
export function scheduleRendererErrorReporting(
  usageStatistics: RendererUsageStatistics,
  schedule: (start: () => void) => void = whenIdle,
  loadReporter: () => Promise<RendererErrorReporterModule> = importSentryRendererErrorReporter,
) {
  const bridge = errorReportingBridge()
  if (state.kind !== 'off' || BUILD_CHANNEL === 'dev' || bridge === null) return
  const begin = () => {
    const pending: unknown[] = []
    state = { kind: 'pending', pending }
    schedule(() => startReporter(bridge, pending, loadReporter))
  }
  if (usageStatistics.isEnabled()) {
    begin()
    return
  }
  state = { kind: 'waiting' }
  const stopWaiting = usageStatistics.subscribe(() => {
    if (state.kind !== 'waiting' || !usageStatistics.isEnabled()) return
    stopWaiting()
    begin()
  })
}

/** Reports an error the app caught, such as a render error caught by an error boundary. */
export function reportRendererError(error: unknown) {
  if (state.kind === 'on') {
    state.reporter.captureException(error)
    return
  }
  if (state.kind === 'pending' && state.pending.length < MAX_PENDING_ERRORS) {
    state.pending.push(error)
  }
}
