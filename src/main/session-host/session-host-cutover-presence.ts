/**
 * Whether a Session Host store, or a legacy one to move, exists: plain file checks the desktop
 * window makes at every start, kept apart from the cutover, which opens SQLite (A-F5).
 */
import { access } from 'node:fs/promises'
import { legacyDatabaseFileState } from './legacy-database-file'

export interface SessionHostCutoverPaths {
  readonly sourceDatabasePath: string
  readonly targetDatabasePath: string
  readonly recoveryDatabasePath: string
}

export async function exists(targetPath: string) {
  try {
    await access(targetPath)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

export function sessionHostTargetExists(paths: SessionHostCutoverPaths) {
  return exists(paths.targetDatabasePath)
}

/** Whether there is a legacy database to migrate; a 0-byte file holds nothing (#357). */
export async function sessionHostSourceExists(paths: SessionHostCutoverPaths) {
  return (await legacyDatabaseFileState(paths.sourceDatabasePath)) === 'present'
}
