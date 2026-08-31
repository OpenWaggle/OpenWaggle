import { access, copyFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  defaultSessionEmbeddingModel,
  type SessionEmbeddingModel,
} from '../adapters/multilingual-e5-session-embedding-model'
import type { LocalSessionHostPaths } from './local-session-paths'
import { runSessionHostCutover, SESSION_HOST_SCHEMA_REVISION } from './session-host-cutover'
import { acquireSessionHostOwnership } from './session-host-ownership'

async function fileStatus(filePath: string) {
  try {
    const metadata = await stat(filePath)
    return {
      exists: true as const,
      path: filePath,
      sizeBytes: metadata.size,
      modifiedAt: metadata.mtimeMs,
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { exists: false as const, path: filePath }
    }
    throw error
  }
}

function activeSchema(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const value: unknown = database
      .prepare(
        'SELECT schema_revision, migration_revision, completed_at FROM session_host_schema_metadata WHERE singleton = 1',
      )
      .get()
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      !('schema_revision' in value) ||
      typeof value.schema_revision !== 'number' ||
      !('migration_revision' in value) ||
      typeof value.migration_revision !== 'string' ||
      !('completed_at' in value) ||
      typeof value.completed_at !== 'number'
    ) {
      return null
    }
    return {
      schemaRevision: value.schema_revision,
      migrationRevision: value.migration_revision,
      completedAt: value.completed_at,
      compatible: value.schema_revision === SESSION_HOST_SCHEMA_REVISION,
    }
  } finally {
    database.close()
  }
}

export async function sessionHostRecoveryStatus(paths: LocalSessionHostPaths) {
  const [active, recovery] = await Promise.all([
    fileStatus(paths.databasePath),
    fileStatus(paths.recoveryDatabasePath),
  ])
  return {
    active: {
      ...active,
      ...(active.exists ? { schema: activeSchema(active.path) } : {}),
    },
    recovery,
  }
}

function archivePath(paths: LocalSessionHostPaths, now: number) {
  return path.join(paths.stateRoot, `session-host.before-restore-${String(now)}.sqlite`)
}

function restoredSourceArtifactPath(paths: LocalSessionHostPaths, now: number) {
  return path.join(paths.stateRoot, `restored-pre-cutover-source-${String(now)}.sqlite`)
}

function checkpoint(databasePath: string) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally {
    database.close()
  }
}

export async function restorePreCutoverDatabase(
  paths: LocalSessionHostPaths,
  now = Date.now(),
  model: SessionEmbeddingModel = defaultSessionEmbeddingModel,
) {
  await access(paths.databasePath)
  await access(paths.recoveryDatabasePath)
  const ownership = await acquireSessionHostOwnership(paths.databasePath)
  const preservedActivePath = archivePath(paths, now)
  const restoredSourceArtifact = restoredSourceArtifactPath(paths, now)
  let activePreserved = false
  try {
    await access(paths.legacyDatabasePath).then(
      () => {
        throw new Error(`Legacy database path is already occupied: ${paths.legacyDatabasePath}`)
      },
      () => undefined,
    )
    checkpoint(paths.databasePath)
    await rename(paths.databasePath, preservedActivePath)
    activePreserved = true
    await copyFile(paths.recoveryDatabasePath, paths.legacyDatabasePath)
    try {
      const result = await runSessionHostCutover(
        {
          sourceDatabasePath: paths.legacyDatabasePath,
          targetDatabasePath: paths.databasePath,
          recoveryDatabasePath: restoredSourceArtifact,
        },
        now,
        model,
      )
      await rm(restoredSourceArtifact, { force: true })
      return { status: 'restored' as const, preservedActivePath, migration: result }
    } catch (error) {
      await rm(paths.legacyDatabasePath, { force: true })
      await rm(paths.databasePath, { force: true })
      await rename(preservedActivePath, paths.databasePath)
      activePreserved = false
      throw error
    }
  } finally {
    if (!activePreserved) await rm(preservedActivePath, { force: true })
    await ownership.release()
  }
}

export async function deletePreCutoverDatabase(paths: LocalSessionHostPaths) {
  const ownership = await acquireSessionHostOwnership(paths.databasePath)
  try {
    const recovery = await fileStatus(paths.recoveryDatabasePath)
    if (!recovery.exists) return { status: 'not-found' as const, path: recovery.path }
    await rm(recovery.path)
    return { status: 'deleted' as const, path: recovery.path, sizeBytes: recovery.sizeBytes }
  } finally {
    await ownership.release()
  }
}
