import { withLegacySessionWriterFence } from './legacy-session-writer-fence'
import {
  type LocalSessionHostPaths,
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
} from './local-session-paths'
import type * as SessionHostCutover from './session-host-cutover'
import { sessionHostTargetExists } from './session-host-cutover-presence'

/** Loaded only when a legacy store may need moving: the cutover opens SQLite (A-F5). */
const importSessionHostCutover = (): Promise<typeof SessionHostCutover> =>
  import('./session-host-cutover')

/**
 * The desktop process is always a Session Host client. Keeping canonical Host
 * ownership in the detached process lets Runs, exports, waits, and subscriptions
 * survive closing or restarting every GUI window.
 */
export async function prepareGuiSessionHostStartup(input: {
  readonly userDataRoot: string
  readonly startupMark: (label: string) => void
  /**
   * The boot shim launched this profile's Host, which moves or creates its store itself while
   * this runs; it did so only when there is no legacy store for this process to move first.
   */
  readonly hostPrelaunched?: boolean
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
  if (!input.hostPrelaunched && !(await sessionHostTargetExists(cutoverPaths))) {
    const { runSessionHostCutover } = await importSessionHostCutover()
    await withLegacySessionWriterFence(() => runSessionHostCutover(cutoverPaths))
    input.startupMark('session-host-cutover-ready')
  }
  return { paths }
}
