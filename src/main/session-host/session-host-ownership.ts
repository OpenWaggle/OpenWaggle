import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import Database from 'better-sqlite3'

const OWNERSHIP_HANDOFF_RETRY_MS = 5
const OWNERSHIP_HANDOFF_TIMEOUT_MS = 1000
/** Fail at once on a held lock; the retry loop below owns the waiting. */
const NO_BUSY_TIMEOUT_MS = 0

export interface AcquireSessionHostOwnershipOptions {
  readonly timeoutMs?: number
}

export interface SessionHostOwnership {
  readonly targetPath: string
  readonly release: () => Promise<void>
}

/** Whether `error` is acquireSessionHostOwnership finding the profile owned by another Host. */
export function isSessionHostOwnershipHeld(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ELOCKED'
}

/*
 * Opened with better-sqlite3, the library of the Host's database connection, so a Host process
 * links one SQLite. This module imports nothing local: a test runs it in a plain Node child.
 */
function tryAcquireOwnershipDatabase(ownershipPath: string) {
  const database = new Database(ownershipPath, { timeout: NO_BUSY_TIMEOUT_MS })
  try {
    // Exclusive locking mode retains the OS file lock across commits until this connection closes.
    // Unlike an mtime lease, a stopped JS event loop cannot lose it and process death releases it.
    database.exec(`
      PRAGMA locking_mode = EXCLUSIVE;
      BEGIN EXCLUSIVE;
      CREATE TABLE IF NOT EXISTS ownership (singleton INTEGER PRIMARY KEY CHECK (singleton = 1));
      COMMIT;
    `)
    return database
  } catch (cause) {
    database.close()
    if (cause instanceof Database.SqliteError && cause.code === 'SQLITE_BUSY') return null
    throw cause
  }
}

/**
 * Holds exclusive ownership independently of the canonical database, including during cutover.
 * The ownership file lives in private user data and must never be removed or replaced: successors
 * open the same inode and let SQLite prove that its previous OS lock has been released.
 */
export async function acquireSessionHostOwnership(
  targetPath: string,
  options: AcquireSessionHostOwnershipOptions = {},
): Promise<SessionHostOwnership> {
  await mkdir(path.dirname(targetPath), { recursive: true })
  const deadline = performance.now() + (options.timeoutMs ?? OWNERSHIP_HANDOFF_TIMEOUT_MS)
  let database = tryAcquireOwnershipDatabase(`${targetPath}.ownership.sqlite`)
  while (!database) {
    if (performance.now() >= deadline) {
      throw Object.assign(new Error('Session Host ownership is already held.'), { code: 'ELOCKED' })
    }
    await setTimeout(OWNERSHIP_HANDOFF_RETRY_MS)
    database = tryAcquireOwnershipDatabase(`${targetPath}.ownership.sqlite`)
  }
  const ownedDatabase = database
  let releasePromise: Promise<void> | null = null
  return {
    targetPath,
    release: () => {
      releasePromise ??= Promise.resolve().then(() => {
        ownedDatabase.close()
      })
      return releasePromise
    },
  }
}
