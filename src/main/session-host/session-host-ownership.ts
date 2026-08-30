import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import lockfile from 'proper-lockfile'

const OWNERSHIP_LOCK_STALE_MS = 120_000
const OWNERSHIP_LOCK_UPDATE_MS = 30_000
const OWNERSHIP_HANDOFF_RETRY_MS = 5
const OWNERSHIP_HANDOFF_RETRIES = 200

export interface SessionHostOwnership {
  readonly targetPath: string
  readonly release: () => Promise<void>
}

/** Holds exclusive ownership of the canonical Session Host store for the process lifetime. */
export async function acquireSessionHostOwnership(
  targetPath: string,
): Promise<SessionHostOwnership> {
  await mkdir(path.dirname(targetPath), { recursive: true })
  const releaseLock = await lockfile.lock(targetPath, {
    realpath: false,
    stale: OWNERSHIP_LOCK_STALE_MS,
    update: OWNERSHIP_LOCK_UPDATE_MS,
    retries: {
      retries: OWNERSHIP_HANDOFF_RETRIES,
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
