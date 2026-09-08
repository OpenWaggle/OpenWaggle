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
import { SESSION_DISCOVERY_TERM_TRIGGER_NAMES } from '../session-host-discovery-term-triggers'
import { SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID } from '../session-host-schema-identity'

const MIGRATION_ID = 31
let temporaryRoot = ''

function withDatabase<A>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, SqlClient.SqlClient>,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe('PRAGMA foreign_keys = ON')
      return yield* run(sql)
    }).pipe(
      Effect.provide(
        SqliteClient.layer({
          filename: path.join(temporaryRoot, 'migration.sqlite'),
          prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
        }),
      ),
    ),
  )
}

function revision30(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* runAppDatabaseMigrations
    for (const name of SESSION_DISCOVERY_TERM_TRIGGER_NAMES) {
      yield* sql.unsafe(`DROP TRIGGER ${name}`)
    }
    for (const name of [
      'session_discovery_term_stage_vocabulary',
      'session_discovery_term_stage',
      'session_discovery_term_postings',
      'session_discovery_term_signatures',
    ]) {
      yield* sql.unsafe(`DROP TABLE ${name}`)
    }
    yield* sql`DELETE FROM _migrations WHERE id = ${MIGRATION_ID}`
    expect(yield* sql`SELECT MAX(id) AS id FROM _migrations`).toEqual([{ id: 30 }])
    yield* sql.unsafe(`
      INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
      VALUES ('a', 'pi-a', 'Preserved', 1, 1), ('b', 'pi-b', 'Second', 1, 1),
        ('empty', 'pi-empty', 'Empty', 1, 1)
    `)
    for (const id of ['a', 'b']) {
      yield* sql`INSERT INTO session_nodes (
        id, session_id, pi_entry_type, kind, role, timestamp_ms, content_json,
        metadata_json, path_depth, created_order
      ) VALUES (${`node-${id}`}, ${id}, 'message', 'message', 'user', 1,
        ${'{"text":"Café alpha alpha"}'}, '{}', 0, 0)`
    }
  })
}

describe('Session discovery native signature migration', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-discovery-migration-'))
  })
  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('upgrades a reopened revision30 target once without repeating legacy cutover or tokenization', async () => {
    await withDatabase(revision30)
    await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        expect(
          yield* sql`SELECT term, initial_frequency, preview_frequency, token_count, member_count
        FROM session_discovery_term_signatures ORDER BY term`,
        ).toEqual([
          {
            term: 'alpha',
            initial_frequency: 2,
            preview_frequency: 2,
            token_count: 6,
            member_count: 2,
          },
          {
            term: 'cafe',
            initial_frequency: 1,
            preview_frequency: 1,
            token_count: 6,
            member_count: 2,
          },
        ])
        expect(yield* sql`SELECT title FROM sessions WHERE id = 'a'`).toEqual([
          { title: 'Preserved' },
        ])
        expect(yield* sql`SELECT COUNT(*) AS count FROM session_node_discovery_search`).toEqual([
          { count: 3 },
        ])
        expect(yield* sql`SELECT * FROM session_discovery_term_stage`).toEqual([])
        expect(yield* sql`SELECT schema_revision FROM session_host_schema_metadata`).toEqual([
          { schema_revision: 18 },
        ])
        expect(yield* sql`SELECT name FROM _migrations WHERE id = ${MIGRATION_ID}`).toEqual([
          { name: 'session-host-native-discovery-signatures' },
        ])
        const statements: string[] = []
        yield* Statement.withTransformer(runAppDatabaseMigrations, (statement) => {
          statements.push(statement.compile()[0])
          return Effect.succeed(statement)
        })
        expect(
          statements.some((statement) =>
            /(?:CREATE|INSERT|DROP|ALTER)/iu.test(
              statement.replace(/CREATE TABLE IF NOT EXISTS _migrations[\s\S]*/u, ''),
            ),
          ),
        ).toBe(false)
        yield* sql`DELETE FROM sessions WHERE id = 'a'`
        expect(
          yield* sql`SELECT term, member_count FROM session_discovery_term_signatures ORDER BY term`,
        ).toEqual([
          { term: 'alpha', member_count: 1 },
          { term: 'cafe', member_count: 1 },
        ])
        expect(yield* sql.unsafe('PRAGMA foreign_key_check')).toEqual([])
      }),
    )
    const database = new DatabaseSync(path.join(temporaryRoot, 'migration.sqlite'))
    try {
      expect(() => validateSessionHostCompletionSeal(database)).not.toThrow()
      database.exec("INSERT INTO _migrations VALUES (32, 'future', 'now')")
      expect(() => validateSessionHostCompletionSeal(database)).toThrow('incompatible')
    } finally {
      database.close()
    }
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBe(MIGRATION_ID)
  })

  it.each(['missing mapping', ''])(
    'rolls back when native discovery has an unmapped %j document',
    async (text) => {
      await withDatabase((sql) =>
        Effect.gen(function* () {
          yield* revision30(sql)
          yield* sql`INSERT INTO session_node_discovery_search
        (session_id, archived, initial_objective, current_preview)
        VALUES ('orphan', 0, ${text}, '')`
        }),
      )
      await expect(withDatabase(() => runAppDatabaseMigrations)).rejects.toThrow()
      await withDatabase((sql) =>
        Effect.gen(function* () {
          expect(yield* sql`SELECT id FROM _migrations WHERE id = ${MIGRATION_ID}`).toEqual([])
          expect(
            yield* sql`SELECT name FROM sqlite_master
        WHERE name = 'session_discovery_term_postings'`,
          ).toEqual([])
          yield* sql`DELETE FROM session_node_discovery_search WHERE session_id = 'orphan'`
          yield* runAppDatabaseMigrations
          expect(yield* sql`SELECT COUNT(*) AS count FROM session_discovery_term_postings`).toEqual(
            [{ count: 4 }],
          )
        }),
      )
    },
  )

  it('installs the fresh baseline with live native postings and an empty staging FTS', async () => {
    await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        yield* sql`INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
        VALUES ('fresh', 'pi-fresh', 'Fresh', 1, 1)`
        yield* sql`INSERT INTO session_nodes (
        id, session_id, pi_entry_type, kind, role, timestamp_ms, content_json,
        metadata_json, path_depth, created_order
      ) VALUES ('node-fresh', 'fresh', 'message', 'message', 'user', 1,
        ${'{"text":"fresh"}'}, '{}', 0, 0)`
        expect(
          yield* sql`SELECT term, member_count FROM session_discovery_term_signatures`,
        ).toEqual([{ term: 'fresh', member_count: 1 }])
        expect(yield* sql`SELECT * FROM session_discovery_term_stage`).toEqual([])
      }),
    )
  })
})
