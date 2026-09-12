import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Statement from '@effect/sql/Statement'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { runAppDatabaseMigrations } from '../../services/database-service'
import {
  SESSION_HOST_DISCOVERY_TERM_MIGRATION_ID,
  SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_ID,
  SESSION_HOST_NODE_DELETE_MIGRATION_ID,
} from '../../services/session-host-schema-identity'
import { runSessionHostCutover } from '../session-host-cutover'
import { fakeEmbeddingModel, seedLegacyDatabase } from './session-host-cutover-test-support'

describe('Session discovery native term cutover', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-discovery-term-cutover-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('populates native signatures before installing live updates and preserves empty documents', async () => {
    const paths = {
      sourceDatabasePath: path.join(temporaryRoot, 'openwaggle.db'),
      targetDatabasePath: path.join(temporaryRoot, 'session-host', 'session-host.sqlite'),
      recoveryDatabasePath: path.join(temporaryRoot, 'openwaggle.pre-session-host-v2.db'),
    }
    seedLegacyDatabase(paths.sourceDatabasePath)
    const source = new DatabaseSync(paths.sourceDatabasePath)
    try {
      source.exec(`
        UPDATE session_nodes SET content_json = '{"text":"Café alpha alpha"}';
        INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
        VALUES ('empty', 'pi-empty', 'Empty', 1, 1);
      `)
    } finally {
      source.close()
    }

    expect(await runSessionHostCutover(paths, 1_000, fakeEmbeddingModel)).toMatchObject({
      status: 'migrated',
      sessionCount: 2,
    })
    const target = new DatabaseSync(paths.targetDatabasePath)
    try {
      target.exec('PRAGMA foreign_keys = ON')
      expect(
        target
          .prepare(`SELECT term, initial_frequency, preview_frequency, token_count,
        member_count FROM session_discovery_term_signatures ORDER BY term`)
          .all(),
      ).toEqual([
        {
          term: 'alpha',
          initial_frequency: 2,
          preview_frequency: 2,
          token_count: 6,
          member_count: 1,
        },
        {
          term: 'cafe',
          initial_frequency: 1,
          preview_frequency: 1,
          token_count: 6,
          member_count: 1,
        },
      ])
      expect(
        target.prepare('SELECT COUNT(*) AS count FROM session_node_discovery_search').get(),
      ).toEqual({ count: 2 })
      expect(target.prepare('SELECT * FROM session_discovery_term_stage').all()).toEqual([])
      target.exec(`UPDATE session_nodes SET content_json = '{"text":"beta"}'`)
      expect(
        target.prepare('SELECT term, member_count FROM session_discovery_term_signatures').all(),
      ).toEqual([{ term: 'beta', member_count: 1 }])
      expect(target.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      target.close()
    }
    expect(await runSessionHostCutover(paths, 2_000, fakeEmbeddingModel)).toMatchObject({
      status: 'already-complete',
    })
    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const before =
          yield* sql`SELECT * FROM _migrations WHERE id = ${SESSION_HOST_DISCOVERY_TERM_MIGRATION_ID}`
        expect(before).toEqual([
          {
            id: SESSION_HOST_DISCOVERY_TERM_MIGRATION_ID,
            name: 'session-host-native-discovery-signatures',
            applied_at: new Date(1_000).toISOString(),
          },
        ])
        const statements: string[] = []
        yield* Statement.withTransformer(runAppDatabaseMigrations, (statement) => {
          statements.push(statement.compile()[0])
          return Effect.succeed(statement)
        })
        expect(statements.some((statement) => statement.includes('fts5vocab'))).toBe(false)
        expect(
          yield* sql`SELECT * FROM _migrations WHERE id = ${SESSION_HOST_DISCOVERY_TERM_MIGRATION_ID}`,
        ).toEqual(before)
        expect(
          yield* sql`SELECT id FROM _migrations WHERE id BETWEEN ${SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_ID} AND ${SESSION_HOST_NODE_DELETE_MIGRATION_ID} ORDER BY id`,
        ).toEqual(
          Array.from({ length: 4 }, (_, index) => ({
            id: SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_ID + index,
          })),
        )
        expect(
          yield* sql`SELECT term, member_count FROM session_discovery_term_signatures`,
        ).toEqual([{ term: 'beta', member_count: 1 }])
        expect(yield* sql.unsafe('PRAGMA foreign_key_check')).toEqual([])
      }).pipe(
        Effect.provide(
          SqliteClient.layer({
            filename: paths.targetDatabasePath,
            prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
          }),
        ),
      ),
    )
  })
})
