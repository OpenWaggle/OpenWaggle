import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { ensureLiveExportAuthority } from '../session-export-live-authority'
import { exportOperation } from './session-export-operation-service.test-support'

describe('live Session export authority', () => {
  let root = ''
  let runtime:
    | ManagedRuntime.ManagedRuntime<SqlClient.SqlClient | SqliteClient.SqliteClient, unknown>
    | undefined

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-live-')))
    const sqlite = SqliteClient.layer({
      filename: path.join(root, 'authority.sqlite'),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    const schema = Layer.effectDiscard(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`
          CREATE TABLE sessions (id TEXT PRIMARY KEY, project_path TEXT)
        `)
        yield* sql.unsafe(`
          CREATE TABLE session_execution_profiles (
            session_id TEXT PRIMARY KEY,
            authorization_ceiling TEXT NOT NULL,
            profile_json TEXT NOT NULL,
            authority_origin_caller_id TEXT NOT NULL,
            authority_scope_snapshot_json TEXT
          )
        `)
        yield* sql.unsafe(`
          CREATE TABLE session_spawn_lineage (
            child_session_id TEXT PRIMARY KEY,
            parent_session_id TEXT NOT NULL,
            hive_root_session_id TEXT NOT NULL
          )
        `)
        yield* sql.unsafe(`
          CREATE TABLE derived_child_management_grants (
            id TEXT PRIMARY KEY,
            child_session_id TEXT NOT NULL,
            source_caller_id TEXT NOT NULL,
            capabilities_json TEXT NOT NULL,
            authorization_ceiling TEXT NOT NULL,
            revoked_at INTEGER
          )
        `)
        yield* sql.unsafe(`
          CREATE TABLE session_client_profiles (
            id TEXT PRIMARY KEY,
            capabilities_json TEXT NOT NULL,
            scope_json TEXT NOT NULL,
            authorization_ceiling TEXT NOT NULL,
            revoked_at INTEGER
          )
        `)
        yield* sql.unsafe(`
          CREATE TABLE workspace_resources (
            id TEXT PRIMARY KEY,
            project_path TEXT NOT NULL,
            working_path TEXT NOT NULL,
            lifecycle_state TEXT NOT NULL
          )
        `)
        yield* sql.unsafe(`
          CREATE TABLE session_workspace_bindings (
            session_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL
          )
        `)
        for (const sessionId of ['queen', 'worker']) {
          yield* sql`INSERT INTO sessions (id, project_path) VALUES (${sessionId}, ${root})`
          yield* sql`
            INSERT INTO session_execution_profiles (
              session_id, authorization_ceiling, profile_json,
              authority_origin_caller_id, authority_scope_snapshot_json
            ) VALUES (
              ${sessionId}, ${'ask-for-approval'},
              ${'{"modelId":"provider/model","thinkingLevel":"medium"}'},
              ${'profile:origin'}, ${null}
            )
          `
          yield* sql`
            INSERT INTO session_workspace_bindings (session_id, workspace_id)
            VALUES (${sessionId}, ${'workspace'})
          `
        }
        yield* sql`
          INSERT INTO workspace_resources (id, project_path, working_path, lifecycle_state)
          VALUES (${'workspace'}, ${root}, ${root}, ${'ready'})
        `
        yield* sql`
          INSERT INTO session_spawn_lineage (
            child_session_id, parent_session_id, hive_root_session_id
          ) VALUES (${'worker'}, ${'queen'}, ${'queen'})
        `
        yield* sql`
          INSERT INTO session_client_profiles (
            id, capabilities_json, scope_json, authorization_ceiling, revoked_at
          ) VALUES (
            ${'origin'},
            ${JSON.stringify(['sessions:export', 'sessions:read'])},
            ${JSON.stringify({ all: true, exportRoots: [root] })},
            ${'ask-for-approval'}, ${null}
          )
        `
      }),
    )
    runtime = ManagedRuntime.make(Layer.provideMerge(schema, sqlite))
  })

  afterEach(async () => {
    await runtime?.dispose()
    runtime = undefined
    await fs.rm(root, { recursive: true, force: true })
  })

  function operation(callerId: string) {
    return {
      ...exportOperation,
      callerId,
      sessionId: 'worker',
      destinationPath: path.join(root, 'worker.jsonl'),
      destinationRoot: root,
    }
  }

  async function check(callerId: string) {
    const active = runtime
    if (!active) throw new Error('Test runtime was not initialized.')
    return active.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* ensureLiveExportAuthority(sql, operation(callerId))
      }),
    )
  }

  async function mutate(statement: (sql: SqlClient.SqlClient) => Effect.Effect<unknown, unknown>) {
    const active = runtime
    if (!active) throw new Error('Test runtime was not initialized.')
    await active.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* statement(sql)
      }).pipe(Effect.orDie),
    )
  }

  it('preserves exact derived-only profile authority and observes live reductions', async () => {
    await mutate(
      (sql) => sql`
      UPDATE session_client_profiles
      SET scope_json = ${JSON.stringify({ sessionIds: ['queen'], exportRoots: [root] })}
      WHERE id = ${'origin'}
    `,
    )
    await mutate(
      (sql) => sql`
      INSERT INTO derived_child_management_grants (
        id, child_session_id, source_caller_id, capabilities_json,
        authorization_ceiling, revoked_at
      ) VALUES (
        ${'grant'}, ${'worker'}, ${'profile:origin'},
        ${JSON.stringify(['sessions:export', 'sessions:read'])},
        ${'ask-for-approval'}, ${null}
      )
    `,
    )

    await expect(check('profile:origin')).resolves.toBeUndefined()
    await mutate(
      (sql) => sql`
      UPDATE derived_child_management_grants SET revoked_at = ${1} WHERE id = ${'grant'}
    `,
    )
    await expect(check('profile:origin')).rejects.toThrow('authority changed')
  })

  it('preserves exact derived capabilities that are absent from the base profile', async () => {
    await mutate(
      (sql) => sql`
      UPDATE session_client_profiles
      SET capabilities_json = ${JSON.stringify([])},
        scope_json = ${JSON.stringify({ sessionIds: ['queen'], exportRoots: [root] })}
      WHERE id = ${'origin'}
    `,
    )
    await mutate(
      (sql) => sql`
      INSERT INTO derived_child_management_grants (
        id, child_session_id, source_caller_id, capabilities_json,
        authorization_ceiling, revoked_at
      ) VALUES (
        ${'grant'}, ${'worker'}, ${'profile:origin'},
        ${JSON.stringify(['sessions:export', 'sessions:read'])},
        ${'ask-for-approval'}, ${null}
      )
    `,
    )

    await expect(check('profile:origin')).resolves.toBeUndefined()
  })

  it('revalidates the current origin-profile capability policy for Session agents', async () => {
    await expect(check('session-agent:queen:run-1')).resolves.toBeUndefined()
    await mutate(
      (sql) => sql`
      UPDATE session_client_profiles
      SET capabilities_json = ${JSON.stringify(['sessions:read'])}
      WHERE id = ${'origin'}
    `,
    )
    await expect(check('session-agent:queen:run-1')).rejects.toThrow('authority changed')
  })
})
