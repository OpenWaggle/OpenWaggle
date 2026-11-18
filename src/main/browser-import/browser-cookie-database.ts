import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { BROWSER_IMPORT_LIMITS } from '@shared/types/browser-import'
import { BrowserImportError } from './browser-import-errors'

const SNAPSHOT_PREFIX = 'openwaggle-browser-import-'

async function assertDatabaseSize(databasePath: string) {
  const databaseStat = await stat(databasePath).catch((cause: unknown) => {
    throw new BrowserImportError(
      'read-failed',
      'The browser cookie store could not be read.',
      cause,
    )
  })
  if (!databaseStat.isFile() || databaseStat.size > BROWSER_IMPORT_LIMITS.DATABASE_BYTES) {
    throw new BrowserImportError(
      'resource-limit',
      `The browser cookie store exceeds the ${String(BROWSER_IMPORT_LIMITS.DATABASE_BYTES)} byte import limit.`,
    )
  }
}

export async function withCookieDatabaseSnapshot<T>(
  databasePath: string,
  read: (database: DatabaseSync) => T | Promise<T>,
) {
  await assertDatabaseSize(databasePath)
  const tempDirectory = await mkdtemp(path.join(tmpdir(), SNAPSHOT_PREFIX))
  const snapshotPath = path.join(tempDirectory, 'cookies.sqlite')
  let source: DatabaseSync | undefined
  let snapshot: DatabaseSync | undefined
  try {
    source = new DatabaseSync(databasePath, { readOnly: true })
    await backup(source, snapshotPath)
    source.close()
    source = undefined
    snapshot = new DatabaseSync(snapshotPath, { readOnly: true })
    return await read(snapshot)
  } catch (cause) {
    if (cause instanceof BrowserImportError) throw cause
    throw new BrowserImportError(
      'read-failed',
      'The browser cookie store could not be read.',
      cause,
    )
  } finally {
    snapshot?.close()
    source?.close()
    await rm(tempDirectory, { force: true, recursive: true })
  }
}

export function numberColumn(row: Record<string, unknown>, key: string) {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function stringColumn(row: Record<string, unknown>, key: string) {
  const value = row[key]
  return typeof value === 'string' ? value : undefined
}

export function bytesColumn(row: Record<string, unknown>, key: string) {
  const value = row[key]
  return value instanceof Uint8Array ? value : undefined
}
