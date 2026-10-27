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
import {
  DELEGATION_ATTENTION_CAUSE_MIGRATION_ID,
  SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID,
  SESSION_NODE_CONTENT_HASH_MIGRATION_ID,
} from '../session-host-schema-identity'
import { SESSION_NODE_CONTENT_HASH_MIGRATION } from '../session-node-content-hash-migration'

const DATABASE_FILE = 'content-hash-upgrade.sqlite'
let temporaryRoot = ''

function withDatabase<A>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, SqlClient.SqlClient>,
) {
  const layer = SqliteClient.layer({
    filename: path.join(temporaryRoot, DATABASE_FILE),
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* run(sql)
    }).pipe(Effect.provide(layer)),
  )
}

/** A beta.27 Session with nodes, before `session_nodes` had a digest column. */
function seedBeta27Session(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
      VALUES (${'session-a'}, ${'pi-a'}, ${'A'}, 1, 1)
    `
    for (const [index, text] of ['alpha', 'beta'].entries()) {
      yield* sql`
        INSERT INTO session_nodes (
          id, session_id, parent_id, pi_entry_type, kind, role, timestamp_ms,
          content_json, metadata_json, branch_hint_id, path_depth, created_order
        ) VALUES (
          ${`node-${String(index)}`}, ${'session-a'}, ${index === 0 ? null : 'node-0'},
          ${'message'}, ${'assistant_message'}, ${'assistant'}, ${index},
          ${JSON.stringify({ text })}, ${'{}'}, ${null}, ${index}, ${index}
        )
      `
    }
  })
}

function readState(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const nodes = yield* sql<{ readonly id: string; readonly content_hash: string | null }>`
      SELECT id, content_hash FROM session_nodes ORDER BY created_order
    `
    const triggers = yield* sql<{ readonly name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name = 'session_nodes_content_hash_guard'
    `
    const ledger = yield* sql<{ readonly id: number; readonly name: string }>`
      SELECT id, name FROM _migrations WHERE id = ${SESSION_NODE_CONTENT_HASH_MIGRATION_ID}
    `
    return {
      nodes: nodes.map((node) => [node.id, node.content_hash]),
      triggers: triggers.map((trigger) => trigger.name),
      ledger: ledger.map((row) => [row.id, row.name]),
    }
  })
}

describe('upgrading a beta.27 database through migration 80', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-content-hash-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('is one this binary supports', () => {
    expect(SESSION_NODE_CONTENT_HASH_MIGRATION.id).toBe(80)
    expect(SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID).toBeGreaterThanOrEqual(
      SESSION_NODE_CONTENT_HASH_MIGRATION_ID,
    )
  })

  it('adds an empty digest to existing nodes without rewriting them, once', async () => {
    await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runMigrations(
          APP_MIGRATIONS.filter(({ id }) => id <= DELEGATION_ATTENTION_CAUSE_MIGRATION_ID),
        )
        yield* seedBeta27Session(sql)
      }),
    )

    const upgraded = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        return yield* readState(sql)
      }),
    )
    expect(upgraded).toEqual({
      nodes: [
        ['node-0', null],
        ['node-1', null],
      ],
      triggers: ['session_nodes_content_hash_guard'],
      ledger: [[80, 'session-node-content-hash']],
    })

    const again = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        return yield* readState(sql)
      }),
    )
    expect(again).toEqual(upgraded)
  })

  it('clears a digest that a content change left stale, and keeps one that was updated with it', async () => {
    const state = await withDatabase((sql) =>
      Effect.gen(function* () {
        yield* runAppDatabaseMigrations
        yield* seedBeta27Session(sql)
        yield* sql`UPDATE session_nodes SET content_hash = ${'digest'}`
        yield* sql`UPDATE session_nodes SET content_json = ${'{"text":"x"}'} WHERE id = ${'node-0'}`
        yield* sql`
          UPDATE session_nodes SET content_json = ${'{"text":"y"}'}, content_hash = ${'new'}
          WHERE id = ${'node-1'}
        `
        return yield* readState(sql)
      }),
    )
    expect(state.nodes).toEqual([
      ['node-0', null],
      ['node-1', 'new'],
    ])
  })
})
