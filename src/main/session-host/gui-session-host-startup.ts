import { withLegacySessionWriterFence } from './legacy-session-writer-fence'
import {
  type LocalSessionHostPaths,
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
} from './local-session-paths'
import { runSessionHostCutover, sessionHostTargetExists } from './session-host-cutover'
import type { SessionHostOwnership } from './session-host-ownership'

/**
 * The desktop process is always a Session Host client. Keeping canonical Host
 * ownership in the detached process lets Runs, exports, waits, and subscriptions
 * survive closing or restarting every GUI window.
 */
export interface GuiSessionHostOwnershipController {
  readonly ensure: () => Promise<SessionHostOwnership>
  readonly release: () => Promise<void>
}

function detachedHostOwnership(): GuiSessionHostOwnershipController {
  return {
    ensure: async () => {
      throw new Error('The GUI cannot own the canonical Session Host store.')
    },
    release: async () => undefined,
  }
}

export async function prepareGuiSessionHostStartup(input: {
  readonly userDataRoot: string
  readonly clientVersion: string
  readonly startupMark: (label: string) => void
}): Promise<{
  readonly paths: LocalSessionHostPaths
  readonly databaseAccess: 'client-isolated'
  readonly ownership: GuiSessionHostOwnershipController
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
  return {
    paths,
    databaseAccess: 'client-isolated',
    ownership: detachedHostOwnership(),
  }
}
