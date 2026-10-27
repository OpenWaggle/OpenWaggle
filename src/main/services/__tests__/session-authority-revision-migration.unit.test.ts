import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runAppDatabaseMigrations } from '../database-service'

let temporaryRoot = ''

function revision(sql: SqlClient.SqlClient) {
  return Effect.map(
    sql<{ readonly revision: number }>`SELECT revision FROM session_authority_revision`,
    (rows) => rows[0]?.revision,
  )
}

describe('the durable authority revision (D4)', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-authority-revision-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('moves on every authority write and on no other', async () => {
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* runAppDatabaseMigrations
        const steps: Record<string, number | undefined> = { start: yield* revision(sql) }
        yield* sql`
          INSERT INTO session_client_profiles (
            id, name, credential_verifier, capabilities_json, scope_json, authorization_ceiling,
            management_envelope_json, created_at, updated_at
          ) VALUES ('p', 'profile', 'v', '[]', '{}', 'ask-for-approval', '{}', 1, 1)
        `
        steps.profileCreated = yield* revision(sql)
        yield* sql`UPDATE session_client_profiles SET last_authenticated_at = 2 WHERE id = 'p'`
        steps.authenticated = yield* revision(sql)
        yield* sql`UPDATE session_client_profiles SET revoked_at = 3 WHERE id = 'p'`
        steps.revoked = yield* revision(sql)
        yield* sql`
          INSERT INTO workspace_resources (
            id, project_path, kind, working_path, lifecycle_state, created_at, updated_at
          ) VALUES ('w', '/p', 'local', '/p', 'ready', 1, 1)
        `
        steps.workspaceCreated = yield* revision(sql)
        yield* sql`UPDATE workspace_resources SET updated_at = 2 WHERE id = 'w'`
        steps.workspaceTouched = yield* revision(sql)
        yield* sql`UPDATE workspace_resources SET working_path = '/q' WHERE id = 'w'`
        steps.workspaceMoved = yield* revision(sql)
        return steps
      }).pipe(
        Effect.provide(
          SqliteClient.layer({ filename: path.join(temporaryRoot, 'authority.sqlite') }),
        ),
      ),
    )
    expect(seen).toEqual({
      start: 0,
      profileCreated: 1,
      authenticated: 1,
      revoked: 2,
      workspaceCreated: 3,
      workspaceTouched: 3,
      workspaceMoved: 4,
    })
  })
})
