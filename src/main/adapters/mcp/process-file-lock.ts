import { mkdirSync } from 'node:fs'
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
  /** With `waitUntilAvailable`, how long to wait before failing; unbounded when omitted. */
  readonly maxWaitMs?: number
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
  maxWaitMs: number | undefined,
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
  const deadline = maxWaitMs === undefined ? undefined : Date.now() + maxWaitMs
  const acquireUntilAvailable = async (): Promise<() => Promise<void>> => {
    while (true) {
      try {
        return await acquireOnce()
      } catch (error) {
        if (!isLockContention(error)) throw error
        // A live holder keeps its lock fresh, so contention alone would wait forever.
        if (deadline !== undefined && Date.now() >= deadline) {
          throw new ProcessFileLockTimeoutError(targetPath, error)
        }
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

/** Another process kept the lock past the wait. */
export class ProcessFileLockTimeoutError extends Error {
  constructor(targetPath: string, cause: unknown) {
    super(`${targetPath} is still held by another process.`, { cause })
    this.name = 'ProcessFileLockTimeoutError'
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
  const run = () =>
    runWithProcessFileLock(targetPath, operation, waitUntilAvailable, options.maxWaitMs)
  return waitUntilAvailable ? withLocalWaitQueue(targetPath, run) : run()
}

/** How long a synchronous transaction waits for another process's lock by default. */
export const SYNC_LOCK_WAIT_MS = 2_000
const SYNC_LOCK_POLL_MS = 10

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, ms)
}

/**
 * The same cross-process lock for a synchronous transaction, such as Pi's synchronous MCP sign-in
 * store. Waits up to `maxWaitMs` for another process, then fails rather than block the Host.
 */
export function withProcessFileLockSync<T>(
  targetPath: string,
  operation: () => T,
  maxWaitMs = SYNC_LOCK_WAIT_MS,
): T {
  mkdirSync(path.dirname(targetPath), { recursive: true })
  const deadline = Date.now() + maxWaitMs
  let release: () => void
  while (true) {
    try {
      release = lockfile.lockSync(targetPath, { realpath: false, stale: LOCK_STALE_MS })
      break
    } catch (error) {
      if (!isLockContention(error)) throw error
      if (Date.now() >= deadline) {
        throw new Error(`${targetPath} is locked by another process.`, { cause: error })
      }
      sleepSync(SYNC_LOCK_POLL_MS)
    }
  }
  try {
    return operation()
  } finally {
    release()
  }
}
