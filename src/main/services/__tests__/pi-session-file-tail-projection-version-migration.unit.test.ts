import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../database-constants'
import { runMigrations } from '../database-migration-runner'
import { APP_MIGRATIONS } from '../database-migrations'
import { runAppDatabaseMigrations } from '../database-service'
import { PI_SESSION_FILE_TAIL_PROJECTION_VERSION_MIGRATION } from '../pi-session-file-tail-projection-version-migration'
import {
  PI_SESSION_FILE_TAIL_PROJECTION_VERSION_MIGRATION_ID,
  SESSION_AUTHORITY_REVISION_MIGRATION_ID,
  SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID,
} from '../session-host-schema-identity'

let temporaryRoot = ''

function withDatabase<A>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, SqlClient.SqlClient>,
) {
  const layer = SqliteClient.layer({
    filename: path.join(temporaryRoot, 'tail-version-upgrade.sqlite'),
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  return Effect.runPromise(Effect.flatMap(SqlClient.SqlClient, run).pipe(Effect.provide(layer)))
}

function readState(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const rows = yield* sql<{
      readonly revision: number
      readonly tail_offset: number | null
      readonly tail_projection_version: number | null
    }>`SELECT revision, tail_offset, tail_projection_version FROM pi_session_file_projections`
    const ledger = yield* sql<{ readonly id: number; readonly name: string }>`
      SELECT id, name FROM _migrations WHERE id = ${PI_SESSION_FILE_TAIL_PROJECTION_VERSION_MIGRATION_ID}
    `
    return { rows, ledger: ledger.map((row) => [row.id, row.name]) }
  })
}

describe('upgrading a database through migration 84', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-tail-version-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('is one this binary supports, after 83 in the ledger', () => {
    expect(PI_SESSION_FILE_TAIL_PROJECTION_VERSION_MIGRATION.id).toBe(84)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBeGreaterThanOrEqual(
      PI_SESSION_FILE_TAIL_PROJECTION_VERSION_MIGRATION_ID,
    )
    const ids = APP_MIGRATIONS.map(({ id }) => id)
    expect(ids.indexOf(PI_SESSION_FILE_TAIL_PROJECTION_VERSION_MIGRATION_ID)).toBeGreaterThan(
      ids.indexOf(SESSION_AUTHORITY_REVISION_MIGRATION_ID),
    )
  })

  it('keeps a recorded tail but with no version, so its next projection reads every entry', async () => {
    await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runMigrations(
          APP_MIGRATIONS.filter(({ id }) => id <= SESSION_AUTHORITY_REVISION_MIGRATION_ID),
        )
        yield* sql`
          INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
          VALUES (${'session-a'}, ${'pi-a'}, ${'A'}, 1, 1)
        `
        yield* sql`
          INSERT INTO pi_session_file_projections (
            session_id, file_size, file_mtime_ms, revision, updated_at, tail_offset
          ) VALUES (${'session-a'}, ${120}, ${5}, ${3}, ${1}, ${120})
        `
      }),
    )

    const upgraded = await withDatabase((sql) =>
      Effect.zipRight(runAppDatabaseMigrations, readState(sql)),
    )
    expect(upgraded).toEqual({
      rows: [{ revision: 3, tail_offset: 120, tail_projection_version: null }],
      ledger: [[84, 'pi-session-file-tail-projection-version']],
    })
    const again = await withDatabase((sql) =>
      Effect.zipRight(runAppDatabaseMigrations, readState(sql)),
    )
    expect(again).toEqual(upgraded)
  })
})
