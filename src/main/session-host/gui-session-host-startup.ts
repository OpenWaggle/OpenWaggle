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
 * Moves a legacy store into a new Session Host store when this profile has no Host store yet,
 * under the single-instance lock, before any Host starts.
 */
export async function moveLegacySessionStoreIfNeeded(input: {
  readonly paths: LocalSessionHostPaths
  readonly startupMark: (label: string) => void
}) {
  const cutoverPaths = {
    sourceDatabasePath: input.paths.legacyDatabasePath,
    targetDatabasePath: input.paths.databasePath,
    recoveryDatabasePath: input.paths.recoveryDatabasePath,
  }
  if (await sessionHostTargetExists(cutoverPaths)) return
  const { runSessionHostCutover } = await importSessionHostCutover()
  await withLegacySessionWriterFence(() => runSessionHostCutover(cutoverPaths))
  input.startupMark('session-host-cutover-ready')
}

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
   * this runs; it did so only when there is no legacy store for this process to move first. The
   * lifecycle moves one itself if that Host ends first (`moveLegacySessionStoreIfNeeded`).
   */
  readonly hostPrelaunched?: boolean
}): Promise<{
  readonly paths: LocalSessionHostPaths
}> {
  const paths = await prepareLocalSessionHostPaths(
    resolveLocalSessionHostPaths({ userDataRoot: input.userDataRoot }),
  )
  input.startupMark('session-host-paths-ready')
  if (!input.hostPrelaunched) {
    await moveLegacySessionStoreIfNeeded({ paths, startupMark: input.startupMark })
  }
  return { paths }
}
