import { existsSync } from 'node:fs'
import { app } from 'electron'
import { flushCliOutput } from './cli-output-flush'
import { env } from './env'
import { applyInstallerUpdateChannelIntent } from './installer-update-channel-intent'
import { initFileLogger, SESSION_HOST_LOG_FILE_STEM } from './logger'
import { configureAppStoragePaths } from './session-data'
import { withLegacySessionWriterFence } from './session-host/legacy-session-writer-fence'
import {
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
  rotateLocalSessionHostEndpoint,
} from './session-host/local-session-paths'
import { startAppSessionHost } from './session-host/session-host-bootstrap'
import {
  runSessionHostCutover,
  sessionHostSourceExists,
  sessionHostTargetExists,
} from './session-host/session-host-cutover'
import { acquireSessionHostOwnership } from './session-host/session-host-ownership'

const FAILURE_EXIT_CODE = 1
const ORPHAN_HOST_GRACE_MS = 10_000
export const UNADOPTABLE_HOST_SWEEP_INTERVAL_MS = 60_000

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
    if (!existsSync(input.endpoint)) void input.stop()
  }, input.intervalMs ?? UNADOPTABLE_HOST_SWEEP_INTERVAL_MS)
  timer.unref()
  return () => clearInterval(timer)
}

export function startSessionHostCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'session-host-internal') return false
  // A detached Host owns no windows and must never register in the macOS Dock.
  if (process.platform === 'darwin') app.setActivationPolicy('accessory')
  configureAppStoragePaths(app, env.OPENWAGGLE_USER_DATA_DIR)
  void app
    .whenReady()
    .then(async () => {
      // The detached Host's console is not attached to anything, so without its own file every
      // failure it recovers from, including a turn that could not be saved, is lost (ADR 0037).
      // Awaited so startup diagnostics are written; initialization failures are reported, not thrown.
      await initFileLogger(app.getPath('logs'), SESSION_HOST_LOG_FILE_STEM)
      const preparedPaths = await prepareLocalSessionHostPaths(
        resolveLocalSessionHostPaths({ userDataRoot: app.getPath('userData') }),
      )
      const ownership = await acquireSessionHostOwnership(preparedPaths.databasePath)
      try {
        const paths = await rotateLocalSessionHostEndpoint(preparedPaths)
        const cutoverPaths = {
          sourceDatabasePath: paths.legacyDatabasePath,
          targetDatabasePath: paths.databasePath,
          recoveryDatabasePath: paths.recoveryDatabasePath,
        }
        const cutover = () => runSessionHostCutover(cutoverPaths)
        if (
          (await sessionHostTargetExists(cutoverPaths)) ||
          !(await sessionHostSourceExists(cutoverPaths))
        ) {
          await cutover()
        } else {
          await withLegacySessionWriterFence(cutover)
        }
        const runtime = await import('./runtime')
        const settings = await import('./store/settings')
        try {
          await runtime.initializeAppRuntime()
          await settings.initializeSettingsStore()
          await applyInstallerUpdateChannelIntent(app.getPath('userData'), (channel) =>
            settings.updateSettingsDurably({ updateChannel: channel }),
          )
          const host = await startAppSessionHost({
            paths,
            externalOwnership: ownership,
            runEffect: runtime.runAppEffect,
            startOwnedServices: runtime.startSessionHostOwnedServices,
            stopOwnedServices: runtime.stopSessionHostOwnedServices,
          })
          const orphanTimer = setTimeout(() => {
            // Once an authenticated client adopts this Host, normal idle grace owns its lifetime.
            if (!host.liveness.hasAcceptedClient() && host.liveness.ownerCount() === 0) {
              void host.stop()
            }
          }, ORPHAN_HOST_GRACE_MS)
          const stopWatchingEndpoint = watchUnadoptableSessionHostEndpoint({
            endpoint: paths.endpoint,
            endpointDirectory: paths.endpointDirectory,
            stop: () => host.stop(),
          })
          try {
            await host.waitUntilStopped()
          } finally {
            clearTimeout(orphanTimer)
            stopWatchingEndpoint()
          }
        } finally {
          await runtime.disposeAppRuntime()
        }
      } finally {
        await ownership.release()
      }
      await flushCliOutput()
      app.exit(0)
    })
    .catch(async (error: unknown) => {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
      await flushCliOutput().catch(() => undefined)
      app.exit(FAILURE_EXIT_CODE)
    })
  return true
}
