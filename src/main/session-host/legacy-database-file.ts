import { rm, stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * The legacy single-file database at the top of the app data folder.
 *
 * `empty` is a 0-byte file with no WAL content beside it. It holds nothing: SQLite treats it as a
 * new database, and no current code writes one. Earlier versions left such files behind, and they
 * blocked `recovery restore-pre-cutover` and made a fresh install try to migrate them (#357). A
 * 0-byte file whose `-wal` holds frames is `present`, because the WAL can hold every page.
 */
export type LegacyDatabaseFileState = 'absent' | 'empty' | 'present'

/** A Host database at the top of the app data folder; only `session-host/` holds the real one. */
export const STRAY_HOST_DATABASE_FILE_NAME = 'session-host.sqlite'

async function sizeOf(filePath: string) {
  try {
    const metadata = await stat(filePath)
    return metadata.isFile() ? metadata.size : Number.POSITIVE_INFINITY
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

export async function legacyDatabaseFileState(
  databasePath: string,
): Promise<LegacyDatabaseFileState> {
  const size = await sizeOf(databasePath)
  if (size === null) return 'absent'
  if (size > 0) return 'present'
  const walSize = await sizeOf(`${databasePath}-wal`)
  return walSize === null || walSize === 0 ? 'empty' : 'present'
}

/** Removes an `empty` legacy database and its empty WAL and shared-memory files. */
export async function removeEmptyLegacyDatabase(databasePath: string) {
  await rm(`${databasePath}-wal`, { force: true })
  await rm(`${databasePath}-shm`, { force: true })
  await rm(databasePath, { force: true })
}

/** The legacy files `recovery status` reports when they exist. */
export function legacyDatabaseFilePaths(legacyDatabasePath: string) {
  return [
    legacyDatabasePath,
    path.join(path.dirname(legacyDatabasePath), STRAY_HOST_DATABASE_FILE_NAME),
  ] as const
}
