import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { LOCAL_SESSION_CURRENT_REVISION } from '../../src/shared/types/local-session-protocol'
import {
  LocalSessionHostUpgradePendingError,
  openLocalSessionConnection,
} from '../../src/main/session-host/local-session-client-connection'
import {
  type LocalSessionHostPaths,
  refreshLocalSessionHostEndpoint,
  resolveLocalSessionHostPaths,
} from '../../src/main/session-host/local-session-paths'
import {
  acquireSessionHostOwnership,
  type SessionHostOwnership,
} from '../../src/main/session-host/session-host-ownership'

const QA_HOST_SHUTDOWN_TIMEOUT_MS = 30_000
const QA_HOST_SHUTDOWN_POLL_INTERVAL_MS = 50
const QA_HOST_CONNECT_TIMEOUT_MS = 250
const QA_HOST_CLIENT_VERSION = 'qa-graceful-shutdown'
const FUTURE_PROTOCOL_REVISION = LOCAL_SESSION_CURRENT_REVISION + 1
const QA_PROFILE_REMOVAL_MAX_RETRIES = 10
const QA_PROFILE_REMOVAL_RETRY_DELAY_MS = 100
const PROPER_LOCKFILE_SUFFIX = '.lock'

type AfterOwnershipReleased = () => Promise<void>
type WhileOwnershipHeld = (
  ownership: SessionHostOwnership,
) => Promise<AfterOwnershipReleased | undefined | void>

interface SessionHostShutdownDependencies {
  readonly resolvePaths: (userDataRoot: string) => LocalSessionHostPaths
  readonly refreshPaths: (paths: LocalSessionHostPaths) => Promise<LocalSessionHostPaths>
  readonly requestDrain: (paths: LocalSessionHostPaths) => Promise<void>
  readonly canConnect: (endpoint: string) => Promise<boolean>
  readonly tryAcquireOwnership: (databasePath: string) => Promise<SessionHostOwnership | null>
  readonly now: () => number
  readonly wait: (milliseconds: number) => Promise<void>
}

function hasErrorCode(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code
}

function isUnavailable(error: unknown) {
  return (
    hasErrorCode(error, 'ENOENT') ||
    hasErrorCode(error, 'ECONNREFUSED') ||
    hasErrorCode(error, 'ECONNRESET') ||
    hasErrorCode(error, 'ECONNABORTED') ||
    hasErrorCode(error, 'EPIPE')
  )
}

function isMissing(error: unknown) {
  return hasErrorCode(error, 'ENOENT')
}

function containsPath(directory: string, candidate: string) {
  const relative = path.relative(directory, candidate)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

async function removeEntriesExcept(root: string, preservedPath: string): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const candidate = path.join(root, entry.name)
    if (candidate === preservedPath) continue
    if (containsPath(candidate, preservedPath)) {
      await removeEntriesExcept(candidate, preservedPath)
      continue
    }
    await fs.rm(candidate, {
      recursive: true,
      force: true,
      maxRetries: QA_PROFILE_REMOVAL_MAX_RETRIES,
      retryDelay: QA_PROFILE_REMOVAL_RETRY_DELAY_MS,
    })
  }
}

async function removeEmptyOwnershipParents(userDataRoot: string, lockPath: string) {
  let candidate = path.dirname(lockPath)
  while (containsPath(userDataRoot, candidate)) {
    try {
      await fs.rmdir(candidate)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    if (candidate === userDataRoot) return
    candidate = path.dirname(candidate)
  }
}

/**
 * Deletes QA profile data without deleting the live proper-lockfile lease. The returned finalizer
 * removes only the empty lock-parent chain after ownership is released, so a competing Host that
 * reacquires first makes cleanup fail closed instead of having its new profile recursively removed.
 */
export async function prepareQaProfileRemoval(
  userDataRoot: string,
  ownership: SessionHostOwnership,
): Promise<AfterOwnershipReleased> {
  const profileRoot = path.resolve(userDataRoot)
  const lockPath = path.resolve(`${ownership.targetPath}${PROPER_LOCKFILE_SUFFIX}`)
  if (lockPath === profileRoot || !containsPath(profileRoot, lockPath)) {
    throw new Error(`Session Host ownership lock is outside the QA profile: ${lockPath}.`)
  }
  await removeEntriesExcept(profileRoot, lockPath)
  return () => removeEmptyOwnershipParents(profileRoot, lockPath)
}

function canConnect(endpoint: string) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection(endpoint)
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, QA_HOST_CONNECT_TIMEOUT_MS)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

async function requestDrain(paths: LocalSessionHostPaths) {
  try {
    const connection = await openLocalSessionConnection({
      paths,
      clientKind: 'internal',
      clientVersion: QA_HOST_CLIENT_VERSION,
      supportedRevisions: [FUTURE_PROTOCOL_REVISION],
    })
    connection.socket.destroy()
    throw new Error('The Session Host unexpectedly accepted the QA shutdown revision.')
  } catch (error) {
    if (!(error instanceof LocalSessionHostUpgradePendingError)) throw error
  }
}

const defaultDependencies: SessionHostShutdownDependencies = {
  resolvePaths: (userDataRoot) => resolveLocalSessionHostPaths({ userDataRoot }),
  refreshPaths: refreshLocalSessionHostEndpoint,
  requestDrain,
  canConnect,
  tryAcquireOwnership: async (databasePath) => {
    try {
      return await acquireSessionHostOwnership(databasePath, { timeoutMs: 0 })
    } catch (error) {
      if (hasErrorCode(error, 'ELOCKED')) return null
      throw error
    }
  },
  now: Date.now,
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}

async function runWhileOwnershipHeld(
  ownership: SessionHostOwnership,
  whileOwnershipHeld: WhileOwnershipHeld,
) {
  let profileFailure: { readonly error: unknown } | null = null
  let afterOwnershipReleased: AfterOwnershipReleased | undefined
  try {
    afterOwnershipReleased = (await whileOwnershipHeld(ownership)) ?? undefined
  } catch (error) {
    profileFailure = { error }
  }
  let releaseFailure: { readonly error: unknown } | null = null
  try {
    await ownership.release()
  } catch (error) {
    releaseFailure = { error }
  }
  if (profileFailure && releaseFailure) {
    throw new AggregateError(
      [profileFailure.error, releaseFailure.error],
      'QA profile cleanup and Session Host ownership release both failed.',
    )
  }
  if (profileFailure) throw profileFailure.error
  if (releaseFailure) throw releaseFailure.error
  await afterOwnershipReleased?.()
}

/**
 * Uses the authenticated version-handoff path to drain a QA Session Host, then holds canonical
 * durable-store ownership until the caller's profile cleanup finishes.
 */
export async function shutdownSessionHostForQa(
  userDataRoot: string,
  whileOwnershipHeld: WhileOwnershipHeld,
  timeoutMs = QA_HOST_SHUTDOWN_TIMEOUT_MS,
  dependencies: SessionHostShutdownDependencies = defaultDependencies,
) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > QA_HOST_SHUTDOWN_TIMEOUT_MS
  ) {
    throw new Error('QA Session Host shutdown timeout is invalid.')
  }

  const basePaths = dependencies.resolvePaths(userDataRoot)
  let paths: LocalSessionHostPaths | null = null
  try {
    paths = await dependencies.refreshPaths(basePaths)
    await dependencies.requestDrain(paths)
  } catch (error) {
    if (!isUnavailable(error)) throw error
  }

  const deadline = dependencies.now() + timeoutMs
  while (dependencies.now() < deadline) {
    const endpointReleased = paths === null || !(await dependencies.canConnect(paths.endpoint))
    if (endpointReleased) {
      const ownership = await dependencies.tryAcquireOwnership(basePaths.databasePath)
      if (ownership) {
        await runWhileOwnershipHeld(ownership, whileOwnershipHeld)
        return
      }
    }
    await dependencies.wait(QA_HOST_SHUTDOWN_POLL_INTERVAL_MS)
  }

  throw new Error(
    `Timed out after ${String(timeoutMs)}ms waiting for the QA Session Host to release ${basePaths.databasePath}.`,
  )
}
