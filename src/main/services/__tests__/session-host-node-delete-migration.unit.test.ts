import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Statement from '@effect/sql/Statement'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateSessionHostCompletionSeal } from '../../session-host/session-host-completion-seal'
import { SQLITE_PREPARE_CACHE_SIZE } from '../database-constants'
import { runAppDatabaseMigrations } from '../database-service'
import {
  SESSION_HOST_NODE_DELETE_MIGRATION_ID,
  SESSION_HOST_SCHEMA_REVISION,
  SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID,
} from '../session-host-schema-identity'
import { sessionTranscriptSearchContentSql } from '../session-transcript-search-content-sql'

const MIGRATION_ID = SESSION_HOST_NODE_DELETE_MIGRATION_ID
const MIGRATION_NAME = 'session-host-cascade-safe-node-deletion'
const LEGACY_DELETE_TRIGGER = `
  CREATE TRIGGER session_node_search_delete BEFORE DELETE ON session_nodes BEGIN
    DELETE FROM session_node_search
    WHERE rowid = (SELECT search_rowid FROM session_node_search_rows WHERE node_id = old.id);
    DELETE FROM session_node_search_rows WHERE node_id = old.id;
    DELETE FROM session_transcript_embedding_queue WHERE node_id = old.id;
    DELETE FROM session_transcript_embeddings WHERE node_id = old.id;
    UPDATE session_transcript_search_stats
    SET searchable_node_count = MAX(0, searchable_node_count -
      CASE WHEN trim(${sessionTranscriptSearchContentSql('old')}) <> '' THEN 1 ELSE 0 END)
    WHERE session_id = old.session_id;
    INSERT INTO session_discovery_embedding_queue (session_id, queued_at)
    VALUES (old.session_id, unixepoch('subsec') * 1000)
    ON CONFLICT(session_id) DO UPDATE SET queued_at = excluded.queued_at;
  END
`

interface MigrationRow {
  readonly id: number
  readonly name: string
  readonly applied_at: string
}

let temporaryRoot = ''

function expectValidCompletionSeal() {
  const database = new DatabaseSync(path.join(temporaryRoot, 'node-delete-migration.sqlite'), {
    readOnly: true,
  })
  try {
    expect(() => validateSessionHostCompletionSeal(database)).not.toThrow()
  } finally {
    database.close()
  }
}

function withDatabase<A>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, SqlClient.SqlClient>,
) {
  const layer = SqliteClient.layer({
    filename: path.join(temporaryRoot, 'node-delete-migration.sqlite'),
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe('PRAGMA foreign_keys = ON')
      return yield* run(sql)
    }).pipe(Effect.provide(layer)),
  )
}

function seedSession(sql: SqlClient.SqlClient, id: string) {
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
      VALUES (${id}, ${`pi-${id}`}, ${'Preserved Session'}, 1, 1)
    `
    yield* sql`
      INSERT INTO session_nodes (
        id, session_id, pi_entry_type, kind, role, timestamp_ms, content_json,
        metadata_json, path_depth, created_order
      ) VALUES (
        ${`${id}-node`}, ${id}, ${'message'}, ${'message'}, ${'user'}, 1,
        ${'{"text":"preserved message"}'}, ${'{}'}, 0, 0
      )
    `
  })
}

function installPreviousRevision(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* runAppDatabaseMigrations
    yield* sql.unsafe('DROP TRIGGER session_node_search_delete')
    yield* sql.unsafe(LEGACY_DELETE_TRIGGER)
    yield* sql`DELETE FROM _migrations WHERE id >= ${MIGRATION_ID}`
    const latest = yield* sql<{ readonly id: number }>`SELECT MAX(id) AS id FROM _migrations`
    expect(latest).toEqual([{ id: MIGRATION_ID - 1 }])
  })
}

describe('Session Host cascade-safe node-delete migration', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-node-delete-migration-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('upgrades the previous target without changing its Session data or schema seal', async () => {
    await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* installPreviousRevision(sql)
        yield* seedSession(sql, 'cascade-target')
        const rejected = yield* sql`DELETE FROM sessions WHERE id = ${'cascade-target'}`.pipe(
          Effect.as(false),
          Effect.catchAll(() => Effect.succeed(true)),
        )
        expect(rejected).toBe(true)
      }),
    )
    expectValidCompletionSeal()

    await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        const preserved = yield* sql<{ readonly title: string; readonly content_json: string }>`
          SELECT sessions.title, session_nodes.content_json
          FROM sessions JOIN session_nodes ON session_nodes.session_id = sessions.id
          WHERE sessions.id = ${'cascade-target'}
        `
        expect(preserved).toEqual([
          { title: 'Preserved Session', content_json: '{"text":"preserved message"}' },
        ])
        const revision = yield* sql<{ readonly schema_revision: number }>`
          SELECT schema_revision FROM session_host_schema_metadata WHERE singleton = 1
        `
        expect(revision).toEqual([{ schema_revision: 18 }])
        yield* sql`DELETE FROM sessions WHERE id = ${'cascade-target'}`
        expect(yield* sql`SELECT id FROM sessions WHERE id = ${'cascade-target'}`).toEqual([])
        expect(
          yield* sql`SELECT id FROM session_nodes WHERE session_id = ${'cascade-target'}`,
        ).toEqual([])
        expect(
          yield* sql`SELECT session_id FROM session_discovery_embedding_queue
          WHERE session_id = ${'cascade-target'}`,
        ).toEqual([])
        expect(yield* sql.unsafe('PRAGMA foreign_key_check')).toEqual([])

        yield* seedSession(sql, 'surviving-target')
        yield* sql`DELETE FROM session_discovery_embedding_queue
          WHERE session_id = ${'surviving-target'}`
        yield* sql`DELETE FROM session_nodes WHERE session_id = ${'surviving-target'}`
        expect(
          yield* sql`SELECT session_id FROM session_discovery_embedding_queue
          WHERE session_id = ${'surviving-target'}`,
        ).toEqual([{ session_id: 'surviving-target' }])
      }),
    )
    expectValidCompletionSeal()
  })

  it('records the node-delete migration once and skips all trigger DDL on the next runtime initialization', async () => {
    await withDatabase(installPreviousRevision)
    const first = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        return yield* sql<MigrationRow>`SELECT * FROM _migrations WHERE id = ${MIGRATION_ID}`
      }),
    )
    const second = await withDatabase((sql) =>
      Effect.gen(function* () {
        const executed: string[] = []
        yield* Statement.withTransformer(runAppDatabaseMigrations, (statement) => {
          executed.push(statement.compile()[0])
          return Effect.succeed(statement)
        })
        expect(executed.some((statement) => /(?:DROP|CREATE)\s+TRIGGER/iu.test(statement))).toBe(
          false,
        )
        return yield* sql<MigrationRow>`SELECT * FROM _migrations WHERE id = ${MIGRATION_ID}`
      }),
    )
    expect(first).toEqual([
      { id: MIGRATION_ID, name: MIGRATION_NAME, applied_at: expect.any(String) },
    ])
    expect(second).toEqual(first)
    expect(SESSION_HOST_SCHEMA_REVISION).toBe(18)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBeGreaterThanOrEqual(MIGRATION_ID)
  })
})
