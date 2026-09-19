import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { resolveSessionToolAgentCaller } from '../session-tool-agent-caller'

describe('historical Worker Sessions tool authority', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-historical-worker-auth-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('cannot turn a prior MCP Worker into a project-scoped Queen', async () => {
    const database = SqliteClient.layer({
      filename: path.join(root, 'authority.sqlite'),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    const attempt = Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`CREATE TABLE sessions (id TEXT PRIMARY KEY, project_path TEXT)`)
        yield* sql.unsafe(`CREATE TABLE session_execution_profiles (
          session_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL,
          authority_origin_caller_id TEXT NOT NULL, authority_scope_snapshot_json TEXT,
          authorization_ceiling TEXT NOT NULL
        )`)
        yield* sql.unsafe(`CREATE TABLE session_spawn_lineage (
          child_session_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL,
          hive_root_session_id TEXT NOT NULL
        )`)
        yield* sql.unsafe(`CREATE TABLE session_lineage (
          session_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL
        )`)
        yield* sql.unsafe(`CREATE TABLE derived_child_management_grants (
          id TEXT PRIMARY KEY, child_session_id TEXT NOT NULL,
          capabilities_json TEXT NOT NULL, revoked_at INTEGER
        )`)
        yield* sql.unsafe(`CREATE TABLE session_client_profiles (
          id TEXT PRIMARY KEY, capabilities_json TEXT NOT NULL,
          scope_json TEXT NOT NULL, authorization_ceiling TEXT NOT NULL, revoked_at INTEGER
        )`)
        yield* sql`INSERT INTO sessions (id, project_path) VALUES
          (${'queen'}, ${'/project'}), (${'worker'}, ${'/project'}),
          (${'sibling'}, ${'/project'})`
        yield* sql`INSERT INTO session_execution_profiles (
          session_id, profile_json, authority_origin_caller_id, authorization_ceiling
        ) VALUES (${'worker'}, ${'{"modelId":"provider/model","thinkingLevel":"medium"}'},
          ${'local-user:cutover'}, ${'yolo'})`
        yield* sql`INSERT INTO session_lineage (session_id, parent_session_id)
          VALUES (${'worker'}, ${'queen'})`
        return yield* resolveSessionToolAgentCaller(sql, {
          sessionId: 'worker',
          runId: 'run-worker',
          workingDirectory: '/project',
        })
      }).pipe(Effect.provide(database)),
    )

    await expect(attempt).rejects.toThrow('Historical Worker ancestry')
  })
})
