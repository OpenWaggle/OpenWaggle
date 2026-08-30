import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { withLegacySessionWriterFence } from './legacy-session-writer-fence'
import { LocalSessionHostUpgradePendingError, probeLocalSessionHost } from './local-session-client'
import {
  HOST_TAKEOVER_TIMEOUT_MS,
  isLocalSessionHostUnavailable,
} from './local-session-host-launcher'
import {
  type LocalSessionHostPaths,
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
} from './local-session-paths'
import { runSessionHostCutover, sessionHostTargetExists } from './session-host-cutover'
import { acquireSessionHostOwnership, type SessionHostOwnership } from './session-host-ownership'

const OWNERSHIP_POLL_INTERVAL_MS = 50

async function prepareOwnedSessionStore(
  paths: LocalSessionHostPaths,
  startupMark: (label: string) => void,
  ownership: SessionHostOwnership,
) {
  const cutoverPaths = {
    sourceDatabasePath: paths.legacyDatabasePath,
    targetDatabasePath: paths.databasePath,
    recoveryDatabasePath: paths.recoveryDatabasePath,
  }
  try {
    const cutover = () => runSessionHostCutover(cutoverPaths)
    if (await sessionHostTargetExists(cutoverPaths)) await cutover()
    else await withLegacySessionWriterFence(cutover)
    startupMark('session-host-cutover-ready')
    return ownership
  } catch (error) {
    await ownership.release()
    throw error
  }
}

function isOwnershipLocked(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ELOCKED'
}

async function tryAcquireSessionHostOwnership(databasePath: string) {
  try {
    return await acquireSessionHostOwnership(databasePath, { timeoutMs: 0 })
  } catch (error) {
    if (isOwnershipLocked(error)) return null
    throw error
  }
}

function waitForOwnershipPoll() {
  return new Promise<void>((resolve) => setTimeout(resolve, OWNERSHIP_POLL_INTERVAL_MS))
}

async function prepareGuiStartupOwnership(input: {
  readonly paths: LocalSessionHostPaths
  readonly clientVersion: string
  readonly startupMark: (label: string) => void
}) {
  let upgradePendingError: LocalSessionHostUpgradePendingError | null = null
  const deadline = Date.now() + HOST_TAKEOVER_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      await probeLocalSessionHost({
        paths: input.paths,
        clientVersion: input.clientVersion,
        clientKind: 'gui',
        supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
      })
      return null
    } catch (error) {
      const isUpgradePending = error instanceof LocalSessionHostUpgradePendingError
      if (isUpgradePending) {
        upgradePendingError = error
      }
      if (!isUpgradePending && !isLocalSessionHostUnavailable(error)) {
        throw error
      }
    }
    const ownership = await tryAcquireSessionHostOwnership(input.paths.databasePath)
    if (ownership) {
      return prepareOwnedSessionStore(input.paths, input.startupMark, ownership)
    }
    await waitForOwnershipPoll()
  }
  if (upgradePendingError) throw upgradePendingError
  throw new Error('Timed out waiting for GUI Session Host authority.')
}

export interface GuiSessionHostOwnershipController {
  readonly ensure: () => Promise<SessionHostOwnership>
  readonly release: () => Promise<void>
}

function createSessionHostOwnershipController(input: {
  readonly paths: LocalSessionHostPaths
  readonly startupMark: (label: string) => void
  readonly initialOwnership: SessionHostOwnership | null
}): GuiSessionHostOwnershipController {
  let ownership = input.initialOwnership
  return {
    async ensure() {
      if (ownership) return ownership
      const acquired = await tryAcquireSessionHostOwnership(input.paths.databasePath)
      if (!acquired) throw new Error('Another Session Host owns the canonical store.')
      ownership = await prepareOwnedSessionStore(input.paths, input.startupMark, acquired)
      return ownership
    },
    async release() {
      const currentOwnership = ownership
      ownership = null
      await currentOwnership?.release()
    },
  }
}

export async function prepareGuiSessionHostStartup(input: {
  readonly userDataRoot: string
  readonly clientVersion: string
  readonly startupMark: (label: string) => void
}) {
  const paths = resolveLocalSessionHostPaths({ userDataRoot: input.userDataRoot })
  await prepareLocalSessionHostPaths(paths)
  input.startupMark('session-host-paths-ready')
  const initialOwnership = await prepareGuiStartupOwnership({
    paths,
    clientVersion: input.clientVersion,
    startupMark: input.startupMark,
  })
  return {
    paths,
    databaseAccess: initialOwnership ? ('owner' as const) : ('client-isolated' as const),
    ownership: createSessionHostOwnershipController({
      paths,
      startupMark: input.startupMark,
      initialOwnership,
    }),
  }
}
