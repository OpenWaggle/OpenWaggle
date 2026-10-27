import { existsSync } from 'node:fs'
import { app } from 'electron'
import { flushCliOutput } from './cli-output-flush'
import { installAutomationDesktopUiBlockers } from './desktop-ui'
import { env, installDesktopShellEnvironment } from './env'
import { flushErrorReporting, reportError, startErrorReporting } from './error-reporting'
import { applyInstallerUpdateChannelIntent } from './installer-update-channel-intent'
import { createLogger, drainFileLogger, initFileLogger, SESSION_HOST_LOG_FILE_STEM } from './logger'
import { configureAppStoragePaths } from './session-data'
import { withLegacySessionWriterFence } from './session-host/legacy-session-writer-fence'
import {
  type LocalSessionHostPaths,
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
  rotateLocalSessionHostEndpoint,
} from './session-host/local-session-paths'
import { createStartupMark } from './startup-timing'
import {
  configureUsageStatisticsHostRecorder,
  flushUsageStatistics,
} from './usage-statistics/usage-statistics-recorder'
import { describeError } from './utils/describe-error'

const FAILURE_EXIT_CODE = 1
const logger = createLogger('session-host-cli')
const startupMark = createStartupMark('session-host/startup')
const ORPHAN_HOST_GRACE_MS = 10_000
/** How long a quit signal waits for the Host to stop and be disposed before it exits anyway. */
export const SESSION_HOST_QUIT_HOLD_MS = 30_000
/** How long that exit waits for the log file to be written, so its reason is not lost. */
export const SESSION_HOST_QUIT_LOG_DRAIN_MS = 2_000
export const UNADOPTABLE_HOST_SWEEP_INTERVAL_MS = 60_000

/**
 * Stops the Host from a timer or an event, where nothing awaits the stop: a stage that fails is
 * logged instead of becoming an unhandled rejection.
 */
function stopUnawaited(stop: () => Promise<void> | void) {
  void Promise.resolve()
    .then(stop)
    .catch((error: unknown) => {
      logger.error('Session Host stop failed', { error: describeError(error) })
    })
}

/**
 * QA leases and temporary userData roots delete the endpoint socket while the detached
 * Host outlives them. Such a Host can never be adopted again, so stop it instead of
 * leaking until reboot. Unix sockets only: Windows named pipes have no filesystem path.
 */
export function watchUnadoptableSessionHostEndpoint(input: {
  readonly endpoint: string
  readonly endpointDirectory: string | null
  readonly stop: () => Promise<void> | void
  readonly intervalMs?: number
}): () => void {
  if (!input.endpoint || !input.endpointDirectory) return () => undefined
  const timer = setInterval(() => {
    if (!existsSync(input.endpoint)) stopUnawaited(input.stop)
  }, input.intervalMs ?? UNADOPTABLE_HOST_SWEEP_INTERVAL_MS)
  timer.unref()
  return () => clearInterval(timer)
}

/**
 * Clients in separate processes (the app, a CLI, an MCP session tool) can each launch a Host when
 * they find it stopped. The Host that owns the profile serves all of them; a Host that finds it
 * owned has nothing to start, and its exit is no crash.
 */
async function acquireOwnershipUnlessHeld(databasePath: string) {
  // Loaded here, not at module load: the desktop window's entry graph reaches this module.
  const ownership = await import('./session-host/session-host-ownership')
  try {
    return await ownership.acquireSessionHostOwnership(databasePath)
  } catch (error) {
    if (ownership.isSessionHostOwnershipHeld(error)) return null
    throw error
  }
}

/**
 * The Host hydrates its own login-shell environment (PATH, SSH agent, locale), the same bounded
 * way the desktop app does, instead of inheriting one the launching GUI waited for (A-F1/A-F7):
 * the GUI launches the Host before its own probe finishes. The probe runs while the Host opens
 * its database and runtime, and the Host serves no client before it settles, so every Run,
 * terminal, git or MCP process it starts still sees the hydrated environment.
 */
export function hydrateSessionHostShellEnvironment(
  install: () => Promise<void> = installDesktopShellEnvironment,
): Promise<void> {
  return install().catch((error: unknown) => {
    logger.warn('The Session Host could not read the login-shell environment', {
      error: describeError(error),
    })
  })
}

/** Exits with the log written, or once a disk that does not answer has had its short chance. */
function exitAfterLogDrain() {
  let exited = false
  const exit = () => {
    if (exited) return
    exited = true
    app.exit(FAILURE_EXIT_CODE)
  }
  setTimeout(exit, SESSION_HOST_QUIT_LOG_DRAIN_MS)
  void drainFileLogger()
    .catch(() => undefined)
    .finally(exit)
}

/**
 * Electron turns SIGTERM and SIGINT into an app quit, which would end the Host at once: the MCP
 * pool would not close, and a stdio server that ignores SIGTERM would outlive it (its SIGKILL is
 * due 2 s later). The quit is held and the Host stopped instead; its disposal closes the pool and
 * kills what is still in its SIGTERM grace, then the Host exits through app.exit(), which skips
 * quit events.
 */
export function stopSessionHostOnQuit(stop: () => Promise<void> | void) {
  let deadline: ReturnType<typeof setTimeout> | undefined
  const holdQuit = (event: { preventDefault(): void }) => {
    event.preventDefault()
    stopUnawaited(stop)
    // A stop that waits on something that never answers, such as a keychain prompt nobody
    // sees, must not keep the Host from exiting: the hold ends after a bounded time.
    deadline ??= setTimeout(() => {
      logger.error('Session Host did not stop in time after a quit signal; exiting', {
        holdMs: SESSION_HOST_QUIT_HOLD_MS,
      })
      exitAfterLogDrain()
    }, SESSION_HOST_QUIT_HOLD_MS)
  }
  app.on('before-quit', holdQuit)
  return () => {
    clearTimeout(deadline)
    app.off('before-quit', holdQuit)
  }
}

/** Rotates the endpoint and moves a legacy store into place, under its writer fence if needed. */
async function prepareSessionHostStore(preparedPaths: LocalSessionHostPaths) {
  const paths = await rotateLocalSessionHostEndpoint(preparedPaths)
  const cutoverPaths = {
    sourceDatabasePath: paths.legacyDatabasePath,
    targetDatabasePath: paths.databasePath,
    recoveryDatabasePath: paths.recoveryDatabasePath,
  }
  // The cutover opens SQLite; loaded here so the window's entry graph never reaches it (A-F5).
  const store = await import('./session-host/session-host-cutover')
  const cutover = () => store.runSessionHostCutover(cutoverPaths)
  if (
    (await store.sessionHostTargetExists(cutoverPaths)) ||
    !(await store.sessionHostSourceExists(cutoverPaths))
  ) {
    await cutover()
  } else {
    await withLegacySessionWriterFence(cutover)
  }
  return paths
}

export function startSessionHostCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'session-host-internal') return false
  // A detached Host owns no windows and must never register in the macOS Dock.
  if (process.platform === 'darwin') app.setActivationPolicy('accessory')
  // It draws nothing either, so it skips the GPU process (A-F13).
  app.disableHardwareAcceleration()
  // The Host inherits OPENWAGGLE_AUTOMATION from the app that started it, so it blocks native UI
  // (dialogs, the browser) the same way, for example a sign-in page an MCP server asks to open.
  installAutomationDesktopUiBlockers()
  configureAppStoragePaths(app, env.OPENWAGGLE_USER_DATA_DIR)
  void app
    .whenReady()
    .then(async () => {
      // The detached Host's console is not attached to anything, so without its own file every
      // failure it recovers from, including a turn that could not be saved, is lost (ADR 0037).
      // Awaited so startup diagnostics are written; initialization failures are reported, not thrown.
      await initFileLogger(app.getPath('logs'), SESSION_HOST_LOG_FILE_STEM)
      startupMark('host-file-logger-ready') // Its uptime dates the process start.
      const preparedPaths = await prepareLocalSessionHostPaths(
        resolveLocalSessionHostPaths({ userDataRoot: app.getPath('userData') }),
      )
      const ownership = await acquireOwnershipUnlessHeld(preparedPaths.databasePath)
      startupMark('host-ownership-settled')
      if (!ownership) {
        logger.info('Another Session Host owns this profile; exiting without starting')
        await drainFileLogger()
        await flushCliOutput()
        app.exit(0)
        return
      }
      // Started once this Host owns the profile, so a Host that exits at once leaves no probe.
      const shellEnvironment = hydrateSessionHostShellEnvironment()
      try {
        const paths = await prepareSessionHostStore(preparedPaths)
        startupMark('host-cutover-settled')
        const runtime = await import('./runtime')
        const settings = await import('./store/settings')
        const { startAppSessionHost } = await import('./session-host/session-host-bootstrap')
        let releaseQuitHold: () => void = () => undefined
        try {
          await runtime.initializeAppRuntime()
          await settings.initializeSettingsStore()
          startupMark('host-settings-initialized')
          // Settings decide whether errors are reported, so reporting starts once they load.
          void startErrorReporting('session-host')
          await applyInstallerUpdateChannelIntent(app.getPath('userData'), (channel) =>
            settings.updateSettingsDurably({ updateChannel: channel }),
          )
          // The Session Host is the only process that sends Usage statistics.
          configureUsageStatisticsHostRecorder({
            userDataDirectory: app.getPath('userData'),
            appVersion: app.getVersion(),
          })
          await shellEnvironment
          startupMark('host-shell-environment-installed')
          const host = await startAppSessionHost({
            paths,
            startupMark,
            externalOwnership: ownership,
            runEffect: runtime.runAppEffect,
            startOwnedServices: async () => {
              const { createDiscoveredSessionWithLifecycle } = await import(
                './application/pi-session-discovery-lifecycle'
              )
              await runtime.startSessionHostOwnedServices({
                createDiscoveredSession: createDiscoveredSessionWithLifecycle,
              })
            },
            startServicesAfterListening: runtime.startSessionHostServicesAfterListening,
            stopOwnedServices: runtime.stopSessionHostOwnedServices,
          })
          const orphanTimer = setTimeout(() => {
            // Once an authenticated client adopts this Host, normal idle grace owns its lifetime.
            if (!host.liveness.hasAcceptedClient() && host.liveness.ownerCount() === 0) {
              stopUnawaited(() => host.stop())
            }
          }, ORPHAN_HOST_GRACE_MS)
          const stopWatchingEndpoint = watchUnadoptableSessionHostEndpoint({
            endpoint: paths.endpoint,
            endpointDirectory: paths.endpointDirectory,
            stop: () => host.stop(),
          })
          // Held until the runtime is disposed, so a second signal cannot cut that short.
          releaseQuitHold = stopSessionHostOnQuit(() => host.stop())
          try {
            await host.waitUntilStopped()
          } finally {
            clearTimeout(orphanTimer)
            stopWatchingEndpoint()
          }
        } finally {
          await flushUsageStatistics()
          await runtime.disposeAppRuntime()
          releaseQuitHold()
        }
      } finally {
        await ownership.release()
      }
      await drainFileLogger()
      await flushCliOutput()
      await flushErrorReporting()
      app.exit(0)
    })
    .catch(async (error: unknown) => {
      // The detached Host's stderr reaches nothing; the Host log is where this can be found.
      logger.error('Session Host stopped on an unrecoverable error', {
        error: describeError(error),
      })
      reportError(error)
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
      await drainFileLogger().catch(() => undefined)
      await flushCliOutput().catch(() => undefined)
      await flushErrorReporting()
      app.exit(FAILURE_EXIT_CODE)
    })
  return true
}
