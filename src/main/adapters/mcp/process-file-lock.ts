import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import lockfile from 'proper-lockfile'

const LOCK_STALE_MS = 120_000
const LOCK_UPDATE_MS = 30_000
const LOCK_RETRIES = 10
const LOCK_RETRY_FACTOR = 1.4
const LOCK_RETRY_MIN_TIMEOUT_MS = 20
const LOCK_RETRY_MAX_TIMEOUT_MS = 300

interface ProcessFileLockOptions {
  readonly waitUntilAvailable?: boolean
}

const waitQueues = new Map<string, Promise<void>>()

async function withLocalWaitQueue<T>(targetPath: string, operation: () => Promise<T>) {
  const previous = waitQueues.get(targetPath) ?? Promise.resolve()
  let releaseTurn = () => {}
  const turn = new Promise<void>((resolve) => {
    releaseTurn = resolve
  })
  const queued = previous.then(() => turn)
  waitQueues.set(targetPath, queued)
  await previous
  try {
    return await operation()
  } finally {
    releaseTurn()
    if (waitQueues.get(targetPath) === queued) waitQueues.delete(targetPath)
  }
}

async function runWithProcessFileLock<T>(
  targetPath: string,
  operation: () => Promise<T>,
  waitUntilAvailable: boolean,
) {
  await mkdir(path.dirname(targetPath), { recursive: true })
  const lockOptions = {
    realpath: false,
    stale: LOCK_STALE_MS,
    update: LOCK_UPDATE_MS,
  } as const
  const acquireOnce = () => lockfile.lock(targetPath, lockOptions)
  const acquireWithRetries = () =>
    lockfile.lock(targetPath, {
      ...lockOptions,
      retries: {
        retries: LOCK_RETRIES,
        factor: LOCK_RETRY_FACTOR,
        minTimeout: LOCK_RETRY_MIN_TIMEOUT_MS,
        maxTimeout: LOCK_RETRY_MAX_TIMEOUT_MS,
        randomize: true,
      },
    })
  let attempt = 0
  const acquireUntilAvailable = async (): Promise<() => Promise<void>> => {
    while (true) {
      try {
        return await acquireOnce()
      } catch (error) {
        if (!isLockContention(error)) throw error
        const timeout = Math.min(
          LOCK_RETRY_MAX_TIMEOUT_MS,
          LOCK_RETRY_MIN_TIMEOUT_MS * LOCK_RETRY_FACTOR ** attempt,
        )
        attempt += 1
        await delay(timeout * (1 + Math.random()))
      }
    }
  }
  const release = await (waitUntilAvailable ? acquireUntilAvailable() : acquireWithRetries())
  try {
    return await operation()
  } finally {
    await release()
  }
}

function isLockContention(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ELOCKED'
}

/**
 * Serializes a filesystem transaction across the desktop app and MCP CLI.
 * The target does not have to exist yet; proper-lockfile owns a sibling lock
 * directory and refreshes it while the transaction is running.
 */
export async function withProcessFileLock<T>(
  targetPath: string,
  operation: () => Promise<T>,
  options: ProcessFileLockOptions = {},
) {
  const waitUntilAvailable = options.waitUntilAvailable ?? false
  const run = () => runWithProcessFileLock(targetPath, operation, waitUntilAvailable)
  return waitUntilAvailable ? withLocalWaitQueue(targetPath, run) : run()
}
