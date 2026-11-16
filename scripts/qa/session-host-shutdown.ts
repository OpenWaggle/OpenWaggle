import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import {
  type LocalSessionHostPaths,
  refreshLocalSessionHostEndpoint,
  resolveLocalSessionHostPaths,
} from '../../src/main/session-host/local-session-paths'
import {
  acquireSessionHostOwnership,
  type SessionHostOwnership,
} from '../../src/main/session-host/session-host-ownership'
import { SESSION_HOST_EXIT_BUDGET_MS } from '../../src/main/session-host/session-host-update-stop'
import { hasErrorCode, processExists, requestStop } from './session-host-stop'

const QA_HOST_SHUTDOWN_TIMEOUT_MS = 30_000
const QA_HOST_SHUTDOWN_POLL_INTERVAL_MS = 50
const QA_HOST_CONNECT_TIMEOUT_MS = 250
const QA_PROFILE_REMOVAL_MAX_RETRIES = 10
const QA_PROFILE_REMOVAL_RETRY_DELAY_MS = 100
const OWNERSHIP_DATABASE_SUFFIX = '.ownership.sqlite'
const SQLITE_COMPANION_SUFFIXES = ['-journal', '-wal', '-shm'] as const

type AfterOwnershipReleased = () => Promise<void>
type WhileOwnershipHeld = (
  ownership: SessionHostOwnership,
) => Promise<AfterOwnershipReleased | undefined | void>

interface SessionHostShutdownDependencies {
  readonly resolvePaths: (userDataRoot: string) => LocalSessionHostPaths
  readonly refreshPaths: (paths: LocalSessionHostPaths) => Promise<LocalSessionHostPaths>
  /**
   * Stops the Host and returns its process id, which the shutdown waits on: the Host releases
   * ownership before its Chromium profile (`session-data`) closes, so only its exit frees every
   * profile file. Undefined when the Host cannot say, as one already handing over cannot.
   */
  readonly requestStop: (paths: LocalSessionHostPaths) => Promise<number | undefined>
  readonly processExists: (processId: number) => boolean
  readonly canConnect: (endpoint: string) => Promise<boolean>
  readonly tryAcquireOwnership: (databasePath: string) => Promise<SessionHostOwnership | null>
  readonly now: () => number
  readonly wait: (milliseconds: number) => Promise<void>
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

function containsPath(directory: string, candidate: string) {
  const relative = path.relative(directory, candidate)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

async function removeEntriesExcept(root: string, preservedPaths: readonly string[]): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const candidate = path.join(root, entry.name)
    if (preservedPaths.includes(candidate)) continue
    if (preservedPaths.some((preservedPath) => containsPath(candidate, preservedPath))) {
      await removeEntriesExcept(candidate, preservedPaths)
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

/**
 * Deletes QA profile data while retaining the SQLite ownership file, its companions and parents.
 * This small, sanitized profile skeleton must remain after release: a successor can already hold
 * its inode, and unlinking it would let a third Host acquire a replacement file concurrently.
 * The finalizer deliberately performs no filesystem work after ownership has been released.
 */
export async function prepareQaProfileRemoval(
  userDataRoot: string,
  ownership: SessionHostOwnership,
) {
  const profileRoot = path.resolve(userDataRoot)
  const lockPath = path.resolve(`${ownership.targetPath}${OWNERSHIP_DATABASE_SUFFIX}`)
  if (lockPath === profileRoot || !containsPath(profileRoot, lockPath)) {
    throw new Error(`Session Host ownership lock is outside the QA profile: ${lockPath}.`)
  }
  // SQLite can retain an open rollback journal in exclusive locking mode after COMMIT.
  // Removing it fails on Windows and unlinks a live SQLite file on POSIX. Leave these
  // exact ownership companions to SQLite, including after a successor acquires ownership.
  await removeEntriesExcept(profileRoot, [
    lockPath,
    ...SQLITE_COMPANION_SUFFIXES.map((suffix) => `${lockPath}${suffix}`),
  ])
  return () => Promise.resolve()
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

const defaultDependencies: SessionHostShutdownDependencies = {
  resolvePaths: (userDataRoot) => resolveLocalSessionHostPaths({ userDataRoot }),
  refreshPaths: refreshLocalSessionHostEndpoint,
  requestStop,
  processExists,
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

/**
 * The Host releases ownership before its Chromium profile closes, and on Windows a file it still
 * holds (`session-data/Local State`) makes the removal fail with EBUSY, so the cleanup waits for
 * its exit. Only for the Host's own exit budget: a reused process id must not hold the cleanup to
 * its timeout, and `fs.rm`'s retries absorb what lag is left.
 */
async function waitForHostProcessExit(
  processId: number | undefined,
  dependencies: SessionHostShutdownDependencies,
) {
  if (processId === undefined) return
  const deadline = dependencies.now() + SESSION_HOST_EXIT_BUDGET_MS
  while (dependencies.processExists(processId) && dependencies.now() < deadline) {
    await dependencies.wait(QA_HOST_SHUTDOWN_POLL_INTERVAL_MS)
  }
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
 * Stops a QA Session Host through the authenticated update stop, waits for its process to exit,
 * then holds canonical durable-store ownership until the caller's profile cleanup finishes.
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
  let processId: number | undefined
  try {
    paths = await dependencies.refreshPaths(basePaths)
    processId = await dependencies.requestStop(paths)
  } catch (error) {
    if (!isUnavailable(error)) throw error
  }

  const deadline = dependencies.now() + timeoutMs
  while (dependencies.now() < deadline) {
    const endpointReleased = paths === null || !(await dependencies.canConnect(paths.endpoint))
    const ownership = endpointReleased
      ? await dependencies.tryAcquireOwnership(basePaths.databasePath)
      : null
    if (ownership) {
      await runWhileOwnershipHeld(ownership, async (held) => {
        await waitForHostProcessExit(processId, dependencies)
        return whileOwnershipHeld(held)
      })
      return
    }
    await dependencies.wait(QA_HOST_SHUTDOWN_POLL_INTERVAL_MS)
  }

  throw new Error(
    `Timed out after ${String(timeoutMs)}ms waiting for the QA Session Host to release ${basePaths.databasePath}.`,
  )
}
