import { mkdir } from 'node:fs/promises'
import path from 'node:path'
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
  await mkdir(path.dirname(targetPath), { recursive: true })
  const release = await lockfile.lock(targetPath, {
    realpath: false,
    stale: LOCK_STALE_MS,
    update: LOCK_UPDATE_MS,
    retries: {
      ...(options.waitUntilAvailable ? { forever: true } : { retries: LOCK_RETRIES }),
      factor: LOCK_RETRY_FACTOR,
      minTimeout: LOCK_RETRY_MIN_TIMEOUT_MS,
      maxTimeout: LOCK_RETRY_MAX_TIMEOUT_MS,
      randomize: true,
    },
  })
  try {
    return await operation()
  } finally {
    await release()
  }
}
