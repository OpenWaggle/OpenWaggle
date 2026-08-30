import { app } from 'electron'
import { env } from './env'
import { configureAppStoragePaths } from './session-data'
import { withLegacySessionWriterFence } from './session-host/legacy-session-writer-fence'
import {
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
} from './session-host/local-session-paths'
import { startAppSessionHost } from './session-host/session-host-bootstrap'
import { runSessionHostCutover, sessionHostTargetExists } from './session-host/session-host-cutover'

const FAILURE_EXIT_CODE = 1
const ORPHAN_HOST_GRACE_MS = 10_000

export function startSessionHostCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'session-host-internal') return false
  configureAppStoragePaths(app, env.OPENWAGGLE_USER_DATA_DIR)
  void app
    .whenReady()
    .then(async () => {
      const paths = resolveLocalSessionHostPaths({ userDataRoot: app.getPath('userData') })
      await prepareLocalSessionHostPaths(paths)
      const cutoverPaths = {
        sourceDatabasePath: paths.legacyDatabasePath,
        targetDatabasePath: paths.databasePath,
        recoveryDatabasePath: paths.recoveryDatabasePath,
      }
      const cutover = () => runSessionHostCutover(cutoverPaths)
      if (await sessionHostTargetExists(cutoverPaths)) await cutover()
      else await withLegacySessionWriterFence(cutover)
      const runtime = await import('./runtime')
      const settings = await import('./store/settings')
      await runtime.initializeAppRuntime()
      try {
        await settings.initializeSettingsStore()
        const host = await startAppSessionHost({
          paths,
          runEffect: runtime.runAppEffect,
          startOwnedServices: runtime.startSessionHostOwnedServices,
          stopOwnedServices: runtime.stopSessionHostOwnedServices,
        })
        const orphanTimer = setTimeout(() => {
          if (host.liveness.ownerCount() === 0) void host.stop()
        }, ORPHAN_HOST_GRACE_MS)
        try {
          await host.waitUntilStopped()
        } finally {
          clearTimeout(orphanTimer)
        }
      } finally {
        await runtime.disposeAppRuntime()
      }
      app.exit(0)
    })
    .catch((error: unknown) => {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
      app.exit(FAILURE_EXIT_CODE)
    })
  return true
}
