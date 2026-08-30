import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import lockfile from 'proper-lockfile'

// Keep stale takeover beyond the supported 15-minute Host drain window. The heartbeat normally
// refreshes every 30 seconds, but a synchronous native cutover must not let another process steal
// the canonical database merely because the JavaScript event loop was temporarily blocked.
const OWNERSHIP_LOCK_STALE_MS = 16 * 60_000
const OWNERSHIP_LOCK_UPDATE_MS = 30_000
const OWNERSHIP_HANDOFF_RETRY_MS = 5
const OWNERSHIP_HANDOFF_RETRIES = 200

export interface AcquireSessionHostOwnershipOptions {
  readonly timeoutMs?: number
}

export interface SessionHostOwnership {
  readonly targetPath: string
  readonly release: () => Promise<void>
}

/** Holds exclusive ownership of the canonical Session Host store for the process lifetime. */
export async function acquireSessionHostOwnership(
  targetPath: string,
  options: AcquireSessionHostOwnershipOptions = {},
): Promise<SessionHostOwnership> {
  await mkdir(path.dirname(targetPath), { recursive: true })
  const retries =
    options.timeoutMs === undefined
      ? OWNERSHIP_HANDOFF_RETRIES
      : Math.ceil(options.timeoutMs / OWNERSHIP_HANDOFF_RETRY_MS)
  const releaseLock = await lockfile.lock(targetPath, {
    realpath: false,
    stale: OWNERSHIP_LOCK_STALE_MS,
    update: OWNERSHIP_LOCK_UPDATE_MS,
    retries: {
      retries,
      factor: 1,
      minTimeout: OWNERSHIP_HANDOFF_RETRY_MS,
      maxTimeout: OWNERSHIP_HANDOFF_RETRY_MS,
    },
  })
  let releasePromise: Promise<void> | null = null
  return {
    targetPath,
    release: () => {
      releasePromise ??= releaseLock()
      return releasePromise
    },
  }
}
