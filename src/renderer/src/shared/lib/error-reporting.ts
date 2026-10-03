/**
 * Renderer error reporting (ADR 0045).
 *
 * The SDK can start only when the main process reports errors, which it signals by having the
 * preload expose the SDK's IPC bridge; Dev builds, automation and the environment opt-outs never
 * get the bridge. It then starts once this window's Settings have Usage statistics on, now or
 * when the user turns them on later, at the next idle moment. The SDK is a separate chunk, so it
 * stays off the startup path, and off entirely while statistics stay off.
 */
import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import { createRendererLogger } from './logger'

interface RendererErrorReporter {
  readonly captureException: (error: unknown) => void
}

interface RendererErrorReporterModule {
  readonly startSentryRendererErrorReporter: () => RendererErrorReporter
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

/** Global the Sentry preload bridge defines when the main process reports errors. */
const ERROR_REPORTING_BRIDGE_GLOBAL = '__SENTRY_IPC__'
/** Errors the app reports while the SDK is about to start; later ones are dropped. */
const MAX_PENDING_ERRORS = 10
/** The SDK starts by then even if the renderer never goes idle. */
const IDLE_START_TIMEOUT_MS = 5_000

const logger = createRendererLogger('error-reporting')
let state: ReportingState = { kind: 'off' }

function hasErrorReportingBridge() {
  return typeof window !== 'undefined' && Reflect.has(window, ERROR_REPORTING_BRIDGE_GLOBAL)
}

function importSentryRendererErrorReporter(): Promise<RendererErrorReporterModule> {
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
  pending: unknown[],
  loadReporter: () => Promise<RendererErrorReporterModule>,
) {
  loadReporter().then(
    ({ startSentryRendererErrorReporter }) => {
      const reporter = startSentryRendererErrorReporter()
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
  if (state.kind !== 'off' || BUILD_CHANNEL === 'dev' || !hasErrorReportingBridge()) return
  const begin = () => {
    const pending: unknown[] = []
    state = { kind: 'pending', pending }
    schedule(() => startReporter(pending, loadReporter))
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
