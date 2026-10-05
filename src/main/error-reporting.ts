/**
 * Starts error reporting in the GUI main process and the Session Host (ADR 0045, 0046) and gives
 * the rest of the main process the error reporting port.
 *
 * Reporting starts once Settings have loaded, and never while an opt-out applies that cannot
 * change while the process runs: a Dev build, automation, `DO_NOT_TRACK`, `PI_TELEMETRY` or `CI`.
 * While the Setting is off nothing is loaded; reporting starts if the user turns Usage
 * statistics on. Once started, every report still waits on Usage statistics being on at the
 * moment it would be sent. Unless a fixed opt-out applies or the SDK failed to start, the main
 * window gets the error-reporting switch, so its renderer can start its own SDK once Usage
 * statistics are on, even when the user turns them on after the window opened.
 */
import { homedir, tmpdir } from 'node:os'
import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import {
  ERROR_REPORT_FLUSH_TIMEOUT_MS,
  ERROR_REPORTING_RENDERER_SWITCH,
  errorReportingRelease,
} from '@shared/error-reporting/error-report-constants'
import { app } from 'electron'
import { describeError } from './error-description'
import { createLogger } from './logger'
import type { ErrorReporter, ErrorReportOrigin } from './ports/error-reporter'

const logger = createLogger('error-reporting')

/** Loaded only when this process reports errors, so a process that never does skips the SDK. */
const importSentryMainErrorReporter = () =>
  import('./adapters/error-reporting/sentry-main-error-reporter')
/** Loaded on start, after Settings: it reads the settings store, which startup loads late. */
const importUsageStatisticsEnablement = () =>
  import('./usage-statistics/usage-statistics-enablement')

type UsageStatisticsEnablementModule = Awaited<ReturnType<typeof importUsageStatisticsEnablement>>

export type ErrorReportingProcess = 'gui' | 'session-host'

/** Opt-outs that hold for the whole life of a process, so reporting never starts under them. */
const FIXED_OPT_OUTS: ReadonlySet<string> = new Set([
  'dev-build',
  'automation',
  'do-not-track',
  'pi-telemetry',
  'ci',
])

const OPERATING_SYSTEM_NAMES: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
}

/** This process's one start attempt; it settles once reporting started, waits or stays off. */
let startup: Promise<void> | null = null
/** Set once the SDK started. */
let reporter: ErrorReporter | null = null
/** Whether this process reports errors once Usage statistics are on: no fixed opt-out, no failure. */
let available = false

function operatingSystem() {
  return {
    name: OPERATING_SYSTEM_NAMES[process.platform] ?? process.platform,
    version: process.getSystemVersion(),
  }
}

async function startSdk(
  processKind: ErrorReportingProcess,
  enablement: UsageStatisticsEnablementModule,
) {
  const { startSentryMainErrorReporter } = await importSentryMainErrorReporter()
  reporter = startSentryMainErrorReporter({
    process: processKind,
    release: errorReportingRelease(app.getVersion()),
    environment: BUILD_CHANNEL,
    homeDirectory: homedir(),
    temporaryDirectory: tmpdir(),
    isEnabled: enablement.isUsageStatisticsEnabled,
    operatingSystem: operatingSystem(),
    arch: process.arch,
  })
}

function stopAfterFailure(error: unknown) {
  available = false
  logger.warn('Error reporting did not start', describeError(error))
}

function startSdkWhenEnabled(
  processKind: ErrorReportingProcess,
  enablement: UsageStatisticsEnablementModule,
) {
  const stopWaiting = enablement.onUsageStatisticsEnablementChange((enabled) => {
    if (!enabled) return
    stopWaiting()
    startSdk(processKind, enablement).catch(stopAfterFailure)
  })
}

async function beginErrorReporting(processKind: ErrorReportingProcess) {
  try {
    const enablement = await importUsageStatisticsEnablement()
    const current = enablement.currentUsageStatisticsEnablement()
    if (!current.enabled && FIXED_OPT_OUTS.has(current.reason)) return
    available = true
    if (current.enabled) await startSdk(processKind, enablement)
    else startSdkWhenEnabled(processKind, enablement)
  } catch (error) {
    stopAfterFailure(error)
  }
}

/**
 * Starts error reporting for this process once Settings have loaded; later calls return the
 * same attempt. Never rejects.
 */
export function startErrorReporting(processKind: ErrorReportingProcess): Promise<void> {
  startup ??= beginErrorReporting(processKind)
  return startup
}

/**
 * Arguments for the main window's renderer: the switch that lets it start its SDK. A renderer
 * report reaches nothing until this process's SDK runs, and is dropped while statistics are off.
 */
export function errorReportingRendererArguments(): readonly string[] {
  return available ? [ERROR_REPORTING_RENDERER_SWITCH] : []
}

/**
 * Reports an error the app caught. Only an `origin` of `application` keeps the message text, so
 * pass it only where the message cannot hold user content. Does nothing while reporting is off.
 */
export function reportError(error: unknown, origin?: ErrorReportOrigin): void {
  void startup?.then(() => reporter?.captureException(error, origin))
}

async function settledWithin(work: Promise<void> | null, timeoutMs: number) {
  if (!work) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Waits up to `timeoutMs` for pending reports, before the process exits. */
export async function flushErrorReporting(timeoutMs = ERROR_REPORT_FLUSH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  await settledWithin(startup, timeoutMs)
  const remaining = Math.max(0, deadline - Date.now())
  if (reporter) await settledWithin(reporter.flush(remaining), remaining)
}

/**
 * Reports a fatal error and waits up to `timeoutMs` for it to be sent, before the process exits.
 * Reporting starts here when Settings loaded before the failure but reporting had not started
 * yet; when Settings never loaded, nothing is sent.
 */
export async function reportErrorBeforeExit(
  error: unknown,
  processKind: ErrorReportingProcess,
  timeoutMs = ERROR_REPORT_FLUSH_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs
  await settledWithin(startErrorReporting(processKind), timeoutMs)
  reportError(error)
  await flushErrorReporting(Math.max(0, deadline - Date.now()))
}
