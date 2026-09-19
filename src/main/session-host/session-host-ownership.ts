import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout } from 'node:timers/promises'

const OWNERSHIP_HANDOFF_RETRY_MS = 5
const OWNERSHIP_HANDOFF_TIMEOUT_MS = 1000
const SQLITE_BUSY = 5

export interface AcquireSessionHostOwnershipOptions {
  readonly timeoutMs?: number
}

export interface SessionHostOwnership {
  readonly targetPath: string
  readonly release: () => Promise<void>
}

function tryAcquireOwnershipDatabase(ownershipPath: string) {
  const database = new DatabaseSync(ownershipPath)
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
    if (cause instanceof Error && 'errcode' in cause && cause.errcode === SQLITE_BUSY) return null
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
      releasePromise ??= Promise.resolve().then(() => ownedDatabase.close())
      return releasePromise
    },
  }
}
