import { access, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  defaultSessionEmbeddingModel,
  type SessionEmbeddingModel,
} from '../adapters/multilingual-e5-session-embedding-model'
import { SESSION_HOST_TARGET_SCHEMA_STATEMENTS } from '../services/session-host-target-schema'
import { readCutoverCount, sourceSchemaRevision } from './session-host-cutover-database'
import {
  normalizeLegacySessionColumns,
  populateSessionHostTarget,
} from './session-host-cutover-population'
import { populateSessionHostSemanticIndex } from './session-host-cutover-semantic'
import { validateSessionHostTarget } from './session-host-cutover-validation'
import { acquireSessionHostOwnership } from './session-host-ownership'

export { SESSION_HOST_SCHEMA_REVISION } from './session-host-cutover-validation'

export const SESSION_HOST_CUTOVER_MIGRATION_ID = 26
export const SESSION_HOST_CUTOVER_MIGRATION_REVISION = 'session-host-v2'
const OWNER_DIRECTORY_MODE = 0o700

export interface SessionHostCutoverPaths {
  readonly sourceDatabasePath: string
  readonly targetDatabasePath: string
  readonly recoveryDatabasePath: string
}

export type SessionHostCutoverResult =
  | { readonly status: 'fresh-install' }
  | { readonly status: 'already-complete'; readonly targetDatabasePath: string }
  | {
      readonly status: 'migrated'
      readonly targetDatabasePath: string
      readonly recoveryDatabasePath: string
      readonly sessionCount: number
      readonly nodeCount: number
    }

async function exists(targetPath: string) {
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

function applyTargetSchema(database: DatabaseSync) {
  for (const statement of SESSION_HOST_TARGET_SCHEMA_STATEMENTS) database.exec(statement)
}

function recordMigrationMetadata(
  database: DatabaseSync,
  input: {
    readonly now: number
    readonly sourceSchemaRevision: number
    readonly sourceCounts: { readonly sessions: number; readonly nodes: number }
  },
) {
  database
    .prepare(`
      UPDATE session_host_schema_metadata
      SET migration_revision = ?, source_high_watermark_json = ?, completed_at = ?
      WHERE singleton = 1
    `)
    .run(
      SESSION_HOST_CUTOVER_MIGRATION_REVISION,
      JSON.stringify({ ...input.sourceCounts, sourceSchemaRevision: input.sourceSchemaRevision }),
      input.now,
    )
  database
    .prepare('INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)')
    .run(
      SESSION_HOST_CUTOVER_MIGRATION_ID,
      'session-host-v2-target-schema',
      new Date(input.now).toISOString(),
    )
}

function prepareStagingDatabase(stagingPath: string, now: number) {
  const database = new DatabaseSync(stagingPath)
  try {
    database.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;')
    const revision = sourceSchemaRevision(database)
    const sourceCounts = {
      sessions: readCutoverCount(database, 'sessions'),
      nodes: readCutoverCount(database, 'session_nodes'),
    }
    try {
      normalizeLegacySessionColumns(database)
      applyTargetSchema(database)
      populateSessionHostTarget(database, now)
      database.exec('COMMIT;')
      return { revision, sourceCounts }
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    }
  } finally {
    database.close()
  }
}

function finalizeStagingDatabase(
  stagingPath: string,
  now: number,
  prepared: ReturnType<typeof prepareStagingDatabase>,
  model: SessionEmbeddingModel,
) {
  const database = new DatabaseSync(stagingPath)
  try {
    database.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;')
    try {
      const validation = validateSessionHostTarget(database, prepared.sourceCounts, model.metadata)
      recordMigrationMetadata(database, {
        now,
        sourceSchemaRevision: prepared.revision,
        sourceCounts: prepared.sourceCounts,
      })
      database.exec('COMMIT;')
      return validation
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    }
  } finally {
    database.close()
  }
}

function validateExistingTarget(targetPath: string, model: SessionEmbeddingModel) {
  const database = new DatabaseSync(targetPath, { readOnly: true })
  try {
    database.exec('BEGIN')
    try {
      const validation = validateSessionHostTarget(database, undefined, model.metadata, {
        requireCompleteSemanticCoverage: false,
      })
      database.exec('COMMIT')
      return validation
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  } finally {
    database.close()
  }
}

async function copySourceToStaging(sourcePath: string, stagingPath: string) {
  const source = new DatabaseSync(sourcePath)
  try {
    source.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    source.prepare('VACUUM INTO ?').run(stagingPath)
  } finally {
    source.close()
  }
}

async function installMigratedDatabase(paths: SessionHostCutoverPaths, stagingPath: string) {
  await rename(paths.sourceDatabasePath, paths.recoveryDatabasePath)
  try {
    await rename(stagingPath, paths.targetDatabasePath)
  } catch (error) {
    await rename(paths.recoveryDatabasePath, paths.sourceDatabasePath)
    throw error
  }
}

export async function runSessionHostCutover(
  paths: SessionHostCutoverPaths,
  now = Date.now(),
  model: SessionEmbeddingModel = defaultSessionEmbeddingModel,
): Promise<SessionHostCutoverResult> {
  const stagingPath = `${paths.targetDatabasePath}.partial`
  await mkdir(path.dirname(paths.targetDatabasePath), {
    recursive: true,
    mode: OWNER_DIRECTORY_MODE,
  })
  if (await exists(paths.targetDatabasePath)) {
    validateExistingTarget(paths.targetDatabasePath, model)
    return { status: 'already-complete', targetDatabasePath: paths.targetDatabasePath }
  }
  const ownership = await acquireSessionHostOwnership(`${paths.targetDatabasePath}.cutover`)
  try {
    if (await exists(paths.targetDatabasePath)) {
      validateExistingTarget(paths.targetDatabasePath, model)
      return { status: 'already-complete', targetDatabasePath: paths.targetDatabasePath }
    }
    if (await exists(paths.recoveryDatabasePath)) {
      if (await exists(stagingPath)) {
        validateExistingTarget(stagingPath, model)
        await rename(stagingPath, paths.targetDatabasePath)
        return { status: 'already-complete', targetDatabasePath: paths.targetDatabasePath }
      }
      throw new Error(
        `Session Host cutover is incomplete: recovery database exists without an active or staged database: ${paths.recoveryDatabasePath}`,
      )
    }
    if (!(await exists(paths.sourceDatabasePath))) return { status: 'fresh-install' }
    await rm(stagingPath, { force: true })
    await copySourceToStaging(paths.sourceDatabasePath, stagingPath)
    const prepared = prepareStagingDatabase(stagingPath, now)
    await populateSessionHostSemanticIndex(stagingPath, model, now)
    const validation = finalizeStagingDatabase(stagingPath, now, prepared, model)
    await installMigratedDatabase(paths, stagingPath)
    return {
      status: 'migrated',
      targetDatabasePath: paths.targetDatabasePath,
      recoveryDatabasePath: paths.recoveryDatabasePath,
      sessionCount: validation.sessions,
      nodeCount: validation.nodes,
    }
  } catch (error) {
    await rm(stagingPath, { force: true })
    throw error
  } finally {
    await ownership.release()
  }
}
