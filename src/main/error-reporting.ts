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
 * statistics are on, even when the user turns them on after the window opened. The switch is
 * decided from the fixed opt-outs alone, so the window can open before Settings load and before
 * the SDK starts (A-F2, A-F16); an SDK that fails later takes it back from later windows.
 *
 * A process whose Settings cannot load, because its Session Host did not start, still reports why:
 * it follows the Setting the Session Host last saved, or the default on an install that never
 * stored Settings ({@link startErrorReportingWithoutSettings}, issue #446).
 */
import { homedir, tmpdir } from 'node:os'
import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import {
  ERROR_REPORT_FLUSH_TIMEOUT_MS,
  ERROR_REPORTING_RENDERER_SWITCH,
  errorReportingRelease,
} from '@shared/error-reporting/error-report-constants'
import { resolveUsageStatisticsEnvironmentBlock } from '@shared/usage-statistics/enablement'
import { appLifecycle } from './desktop-shell/app-lifecycle'
import { appPaths } from './desktop-shell/app-paths'
import { usageStatisticsEnv } from './usage-statistics-env'
import { describeError } from './error-description'
import { createLogger } from './logger'
import type { ErrorReporter, ErrorReportOrigin } from './ports/error-reporter'
import { type StartupFailureContext, StartupFailureSummary } from './startup-failure-summary'

const logger = createLogger('error-reporting')

/** Loaded only when this process reports errors, so a process that never does skips the SDK. */
const importSentryMainErrorReporter = () =>
  import('./adapters/electron/error-reporting/sentry-main-error-reporter')
/** Loaded on start, after Settings: it reads the settings store, which startup loads late. */
const importUsageStatisticsEnablement = () =>
  import('./usage-statistics/usage-statistics-enablement')
/** Loaded only by a process whose Settings could not load. */
const importLastKnownSetting = () =>
  import('./usage-statistics/usage-statistics-last-known-setting')

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

/**
 * The current start attempt; it settles once reporting started, waits or stays off. A later
 * attempt without Settings chains onto it ({@link startErrorReportingWithoutSettings}).
 */
let startup: Promise<void> | null = null
/** Set when the SDK starts after its start attempt settled, once Usage statistics turned on. */
let lateSdkStart: Promise<void> | null = null
/** Set once the SDK started. */
let reporter: ErrorReporter | null = null
/** Set once the SDK failed to start; this process then reports nothing. */
let failed = false

/** The build or environment opt-out, which holds for the life of the process. */
function fixedOptOutApplies() {
  return (
    resolveUsageStatisticsEnvironmentBlock({
      buildChannel: BUILD_CHANNEL,
      env: usageStatisticsEnv(),
    }) !== null
  )
}

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
    release: errorReportingRelease(appLifecycle.version()),
    environment: BUILD_CHANNEL,
    homeDirectory: homedir(),
    temporaryDirectory: tmpdir(),
    isEnabled: enablement.isUsageStatisticsEnabled,
    operatingSystem: operatingSystem(),
    arch: process.arch,
  })
}

function stopAfterFailure(error: unknown) {
  failed = true
  logger.warn('Error reporting did not start', describeError(error))
}

function startSdkWhenEnabled(
  processKind: ErrorReportingProcess,
  enablement: UsageStatisticsEnablementModule,
) {
  const stopWaiting = enablement.onUsageStatisticsEnablementChange((enabled) => {
    if (!enabled) return
    stopWaiting()
    lateSdkStart = startSdk(processKind, enablement).catch(stopAfterFailure)
  })
}

/**
 * The Session Host saves the Setting each time it loads or changes, for a later GUI or Host that
 * fails before it can load Settings ({@link startErrorReportingWithoutSettings}).
 */
async function recordLastKnownSetting() {
  try {
    const lastKnown = await importLastKnownSetting()
    lastKnown.recordLastKnownUsageStatisticsSetting(appPaths.userData())
  } catch (error) {
    logger.warn('The Usage statistics Setting will not be saved', describeError(error))
  }
}

async function beginErrorReporting(processKind: ErrorReportingProcess) {
  try {
    const enablement = await importUsageStatisticsEnablement()
    const current = enablement.currentUsageStatisticsEnablement()
    if (!current.enabled && FIXED_OPT_OUTS.has(current.reason)) return
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
  if (startup) return startup
  // Only a Host whose Settings loaded saves the Setting, so a Host that fails before then (and
  // may not own the profile) never writes the file. Not awaited: it never delays reporting.
  if (processKind === 'session-host') void recordLastKnownSetting().catch(() => undefined)
  startup = beginErrorReporting(processKind)
  return startup
}

/**
 * Starts error reporting in a process whose Settings could not load, such as a GUI whose Session
 * Host did not start (issue #446). It acts on the Setting the Session Host last saved, or the
 * default on an install that never stored Settings, until Settings load; with neither, or with
 * that Setting off, it reports nothing, as before. When reporting already started and waits on
 * Settings that never loaded, as in a Host whose Settings read failed, the saved Setting applies
 * to that attempt. Never rejects.
 */
export function startErrorReportingWithoutSettings(
  processKind: ErrorReportingProcess,
): Promise<void> {
  if (fixedOptOutApplies()) {
    startup ??= beginErrorReporting(processKind)
    return startup
  }
  // A Host whose Settings read failed already started reporting, which waits on the Setting:
  // assuming the saved Setting then starts the SDK through that wait.
  const earlier = startup
  startup = (async () => {
    await earlier
    await assumeLastKnownSetting()
    // Settles once the SDK started, so a report queued on this attempt reaches it.
    if (earlier) await lateSdkStart
    else await beginErrorReporting(processKind)
  })()
  return startup
}

async function assumeLastKnownSetting() {
  try {
    const [enablement, lastKnown] = await Promise.all([
      importUsageStatisticsEnablement(),
      importLastKnownSetting(),
    ])
    const current = enablement.currentUsageStatisticsEnablement()
    if (current.enabled || current.reason !== 'settings-unavailable') return
    enablement.assumeUsageStatisticsSettingUntilSettingsLoad(
      lastKnown.usageStatisticsSettingWithoutSettings(appPaths.userData()),
    )
  } catch (error) {
    logger.warn('The last known Usage statistics Setting could not be read', describeError(error))
  }
}

/**
 * Arguments for the main window's renderer: the switch that lets it start its SDK. A renderer
 * report reaches nothing until this process's SDK runs, and is dropped while statistics are off.
 */
export function errorReportingRendererArguments(): readonly string[] {
  return failed || fixedOptOutApplies() ? [] : [ERROR_REPORTING_RENDERER_SWITCH]
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
 * Reports why the Session Host did not start or stopped, as a content-free summary that keeps its
 * message (startup-failure-summary.ts). Reporting starts here when it has not, from the Setting
 * the Session Host last saved when Settings never loaded ({@link startErrorReportingWithoutSettings}).
 */
export function reportStartupFailure(
  error: unknown,
  context: StartupFailureContext,
): Promise<void> {
  const started = startErrorReportingWithoutSettings(
    context === 'session-host' ? 'session-host' : 'gui',
  )
  reportError(new StartupFailureSummary(context, error), 'application')
  return started
}

/**
 * Reports a fatal startup error and waits up to `timeoutMs` for it to be sent, before the process
 * exits. Reporting starts here when it has not, from the Setting the Session Host last saved when
 * Settings never loaded.
 */
export async function reportErrorBeforeExit(
  error: unknown,
  context: StartupFailureContext,
  timeoutMs = ERROR_REPORT_FLUSH_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs
  await settledWithin(reportStartupFailure(error, context), timeoutMs)
  await flushErrorReporting(Math.max(0, deadline - Date.now()))
}
