import { withLegacySessionWriterFence } from './legacy-session-writer-fence'
import {
  type LocalSessionHostPaths,
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
} from './local-session-paths'
import { sessionHostTargetExists } from './session-host-cutover-presence'

/** Loaded only when a legacy store may need moving: the cutover opens SQLite (A-F5). */
const importSessionHostCutover = () => import('./session-host-cutover')

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

interface GuiSessionHostStartup {
  readonly paths: LocalSessionHostPaths
  /**
   * Secures and creates the paths if this start left them to a prelaunched Host, before this
   * process launches one itself; once, and nothing otherwise.
   */
  readonly ensurePrepared: () => Promise<void>
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
  readonly platform?: NodeJS.Platform
}) {
  const resolved = resolveLocalSessionHostPaths({ userDataRoot: input.userDataRoot })
  // On Windows the prelaunched Host secures the state directory and rotates the capability file
  // meanwhile; securing them from here too would race its rename. The GUI only reads what it
  // publishes (`waitForPrelaunchedLocalSessionHost`), and prepares them itself if it ends first.
  if (input.hostPrelaunched && (input.platform ?? process.platform) === 'win32') {
    input.startupMark('session-host-paths-ready')
    let preparation: Promise<unknown> | null = null
    return {
      paths: resolved,
      ensurePrepared: async () => {
        preparation ??= prepareLocalSessionHostPaths(resolved)
        await preparation
      },
    } satisfies GuiSessionHostStartup
  }
  const paths = await prepareLocalSessionHostPaths(resolved)
  input.startupMark('session-host-paths-ready')
  if (!input.hostPrelaunched) {
    await moveLegacySessionStoreIfNeeded({ paths, startupMark: input.startupMark })
  }
  return { paths, ensurePrepared: async () => undefined } satisfies GuiSessionHostStartup
}
