import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { SESSION_ATTACHMENT_TARGET_SCHEMA_STATEMENTS } from '../../services/session-host-attachment-schema'
import { SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION } from '../../services/session-host-browser-attachment-migration'
import { sessionControlAttachmentServiceLayer } from '../session-control-attachment-service'

const roots: string[] = []

export async function cleanupAttachmentFixtures() {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
}

export function testLayer(
  databasePath: string,
  policy: Parameters<typeof sessionControlAttachmentServiceLayer>[0] = {},
) {
  const sqlite = SqliteClient.layer({
    filename: databasePath,
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe('PRAGMA foreign_keys = ON')
      yield* sql.unsafe('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
      yield* sql.unsafe(
        'CREATE TABLE session_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL, intent_json TEXT)',
      )
      yield* sql.unsafe(
        'CREATE TABLE session_follow_ups (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_json TEXT NOT NULL)',
      )
      yield* sql.unsafe(
        'CREATE TABLE session_operations (id INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL, target_scope TEXT NOT NULL, request_json TEXT NOT NULL, status TEXT NOT NULL, outcome_json TEXT)',
      )
      for (const statement of [
        ...SESSION_ATTACHMENT_TARGET_SCHEMA_STATEMENTS,
        ...SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION.statements,
      ]) {
        yield* sql.unsafe(statement)
      }
      yield* sql`INSERT INTO sessions (id) VALUES (${'session-a'}), (${'session-b'})`
    }).pipe(Effect.provide(sqlite)),
  )
  return Layer.mergeAll(
    sqlite,
    schema,
    sessionControlAttachmentServiceLayer(policy).pipe(Layer.provide(sqlite)),
  )
}

export async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-attachment-store-'))
  roots.push(root)
  const source = path.join(root, 'evidence.txt')
  await fs.writeFile(source, 'immutable evidence')
  return { root, source, databasePath: path.join(root, 'session-host.db') }
}
