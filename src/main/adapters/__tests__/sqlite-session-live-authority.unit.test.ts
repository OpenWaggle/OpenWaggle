import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { liveSessionAuthorityBlockReason } from '../sqlite-session-live-authority'

describe('live Session authority admission', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-live-authority-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('fails closed for a revoked direct profile and a revoked Worker grant', async () => {
    const sqlite = SqliteClient.layer({
      filename: path.join(temporaryRoot, 'authority.sqlite'),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`
          CREATE TABLE session_client_profiles (id TEXT PRIMARY KEY, revoked_at INTEGER)
        `)
        yield* sql.unsafe(`
          CREATE TABLE session_execution_profiles (
            session_id TEXT PRIMARY KEY,
            authority_origin_caller_id TEXT NOT NULL,
            authority_scope_snapshot_json TEXT
          )
        `)
        yield* sql.unsafe(`
          CREATE TABLE session_spawn_lineage (
            child_session_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL
          )
        `)
        yield* sql.unsafe(`
          CREATE TABLE derived_child_management_grants (
            id TEXT PRIMARY KEY, child_session_id TEXT NOT NULL, revoked_at INTEGER
          )
        `)
        yield* sql`
          INSERT INTO session_client_profiles (id, revoked_at)
          VALUES (${'origin'}, ${10})
        `
        yield* sql`
          INSERT INTO session_execution_profiles (session_id, authority_origin_caller_id)
          VALUES (${'worker'}, ${'profile:origin'})
        `
        yield* sql`
          INSERT INTO session_spawn_lineage (child_session_id, parent_session_id)
          VALUES (${'worker'}, ${'queen'})
        `
        yield* sql`
          INSERT INTO derived_child_management_grants (id, child_session_id, revoked_at)
          VALUES (${'grant-worker'}, ${'worker'}, ${10})
        `
        return yield* Effect.all([
          liveSessionAuthorityBlockReason(sql, 'profile:origin'),
          liveSessionAuthorityBlockReason(sql, 'session-agent:worker:run-1'),
        ])
      }).pipe(Effect.provide(sqlite)),
    )

    expect(result).toEqual(['profile_revoked', 'profile_revoked'])
  })
})
