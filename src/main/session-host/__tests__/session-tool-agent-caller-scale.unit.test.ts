import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { resolveSessionToolAgentCaller } from '../session-tool-agent-caller'

describe('Sessions tool agent authority at catalog scale', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-tool-scale-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('does not materialize unrelated project Sessions into a derived-grant IN list', async () => {
    const sqlite = SqliteClient.layer({
      filename: path.join(temporaryRoot, 'authority.sqlite'),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    const caller = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe('CREATE TABLE sessions (id TEXT PRIMARY KEY, project_path TEXT)')
        yield* sql.unsafe(`
          CREATE TABLE session_execution_profiles (
            session_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL,
            authority_origin_caller_id TEXT NOT NULL,
            authority_scope_snapshot_json TEXT, authorization_ceiling TEXT NOT NULL
          )
        `)
        yield* sql.unsafe(`
          CREATE TABLE session_spawn_lineage (
            child_session_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL,
            hive_root_session_id TEXT NOT NULL
          )
        `)
        yield* sql.unsafe(`
          CREATE TABLE derived_child_management_grants (
            id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL,
            child_session_id TEXT NOT NULL UNIQUE, source_caller_id TEXT NOT NULL,
            capabilities_json TEXT NOT NULL, authorization_ceiling TEXT NOT NULL,
            revoked_at INTEGER
          )
        `)
        yield* sql.unsafe(`
          CREATE TABLE session_client_profiles (
            id TEXT PRIMARY KEY, capabilities_json TEXT NOT NULL, scope_json TEXT NOT NULL,
            authorization_ceiling TEXT NOT NULL, revoked_at INTEGER
          )
        `)
        yield* sql`
          INSERT INTO sessions (id, project_path) VALUES (${'queen'}, ${'/project'})
        `
        yield* sql`
          INSERT INTO session_execution_profiles (
            session_id, profile_json, authority_origin_caller_id, authorization_ceiling
          ) VALUES (
            ${'queen'}, ${'{"modelId":"provider/model","thinkingLevel":"medium"}'},
            ${'local-user'}, ${'ask-for-approval'}
          )
        `
        yield* sql.unsafe(`
          WITH RECURSIVE counter(value) AS (
            SELECT 1 UNION ALL SELECT value + 1 FROM counter WHERE value < 33000
          )
          INSERT INTO sessions (id, project_path)
          SELECT 'unrelated-' || value, '/project' FROM counter
        `)
        return yield* resolveSessionToolAgentCaller(sql, {
          sessionId: 'queen',
          runId: 'run-queen',
          workingDirectory: '/project',
        })
      }).pipe(Effect.provide(sqlite)),
    )

    expect(caller.profileAuthority.scope).toEqual({
      projectPaths: ['/project'],
      exportRoots: ['/project'],
      attachmentRoots: ['/project'],
    })
    expect(caller.derivedSessionAuthorities).toEqual([])
  })
})
