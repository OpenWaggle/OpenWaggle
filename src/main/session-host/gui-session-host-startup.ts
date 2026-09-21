import { withLegacySessionWriterFence } from './legacy-session-writer-fence'
import {
  type LocalSessionHostPaths,
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
} from './local-session-paths'
import { runSessionHostCutover, sessionHostTargetExists } from './session-host-cutover'

/**
 * The desktop process is always a Session Host client. Keeping canonical Host
 * ownership in the detached process lets Runs, exports, waits, and subscriptions
 * survive closing or restarting every GUI window.
 */
export async function prepareGuiSessionHostStartup(input: {
  readonly userDataRoot: string
  readonly startupMark: (label: string) => void
}): Promise<{
  readonly paths: LocalSessionHostPaths
}> {
  const paths = await prepareLocalSessionHostPaths(
    resolveLocalSessionHostPaths({ userDataRoot: input.userDataRoot }),
  )
  input.startupMark('session-host-paths-ready')
  const cutoverPaths = {
    sourceDatabasePath: paths.legacyDatabasePath,
    targetDatabasePath: paths.databasePath,
    recoveryDatabasePath: paths.recoveryDatabasePath,
  }
  if (!(await sessionHostTargetExists(cutoverPaths))) {
    await withLegacySessionWriterFence(() => runSessionHostCutover(cutoverPaths))
    input.startupMark('session-host-cutover-ready')
  }
  return { paths }
}
