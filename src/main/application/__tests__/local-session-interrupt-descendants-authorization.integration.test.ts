import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteSessionAuthorizationTargetRepositoryLive } from '../../adapters/sqlite-session-authorization-target-repository'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS } from '../../services/session-host-target-schema'
import { SettingsService } from '../../services/settings-service'
import { authorizeLocalSessionCommand } from '../local-session-command-dispatcher'
import { controlPayload } from './local-session-command-dispatcher.test-support'

function testLayer(filename: string) {
  const sqlite = SqliteClient.layer({ filename, prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, pi_session_id TEXT NOT NULL UNIQUE, project_path TEXT,
          title TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )
      `)
      for (const statement of SESSION_CONTROL_TARGET_SCHEMA_STATEMENTS) {
        yield* sql.unsafe(statement)
      }
      for (const sessionId of ['queen', 'worker']) {
        yield* sql`
          INSERT INTO sessions (id, pi_session_id, project_path, title, created_at, updated_at)
          VALUES (${sessionId}, ${`pi-${sessionId}`}, ${'/project'}, ${sessionId}, ${1}, ${1})
        `
        yield* sql`
          INSERT INTO session_execution_profiles (
            session_id, profile_json, authority_origin_caller_id,
            authorization_ceiling, created_at, updated_at
          ) VALUES (${sessionId}, ${'{}'}, ${'local-user'}, ${'ask-for-approval'}, ${1}, ${1})
        `
      }
      yield* sql`
        INSERT INTO session_runs (id, session_id, status, created_at, updated_at)
        VALUES
          (${'run-queen'}, ${'queen'}, ${'active'}, ${1}, ${1}),
          (${'run-worker'}, ${'worker'}, ${'active'}, ${1}, ${1})
      `
      yield* sql`
        INSERT INTO session_control_states (
          session_id, state_revision, queue_state, queue_revision, active_run_id, updated_at
        ) VALUES
          (${'queen'}, ${1}, ${'running'}, ${0}, ${'run-queen'}, ${1}),
          (${'worker'}, ${1}, ${'running'}, ${0}, ${'run-worker'}, ${1})
      `
      yield* sql`
        INSERT INTO session_spawn_lineage (
          child_session_id, parent_session_id, parent_run_id,
          hive_root_session_id, depth, created_at
        ) VALUES (${'worker'}, ${'queen'}, ${'run-queen'}, ${'queen'}, ${1}, ${1})
      `
    }).pipe(Effect.provide(sqlite)),
  )
  const settings = Layer.succeed(SettingsService, {
    get: () => Effect.succeed(DEFAULT_SETTINGS),
    update: () => Effect.void,
    initialize: () => Effect.void,
    flushForTests: () => Effect.void,
  })
  return Layer.mergeAll(
    sqlite,
    schema,
    settings,
    SqliteSessionAuthorizationTargetRepositoryLive.pipe(Layer.provide(sqlite)),
  )
}

function caller(scope: NonNullable<LocalSessionCallerIdentity['profileAuthority']>['scope']) {
  return {
    callerId: 'profile:restricted',
    profileAuthority: {
      profileId: 'restricted',
      profileName: 'restricted',
      capabilities: ['sessions:interrupt'],
      scope,
      authorizationCeiling: 'ask-for-approval',
    },
  } satisfies LocalSessionCallerIdentity
}

describe('interrupt-descendants restricted profile authorization', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-descendant-auth-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('requires every active descendant exact target or one broad Hive/project grant', async () => {
    const layer = testLayer(path.join(temporaryRoot, 'authorization.sqlite'))
    const payload = controlPayload({ operation: 'interrupt-descendants', sessionId: 'queen' })
    const exactError = await Effect.runPromise(
      Effect.gen(function* () {
        const denied = yield* authorizeLocalSessionCommand({
          caller: caller({ sessionIds: ['queen'] }),
          payload,
        }).pipe(Effect.flip)
        yield* authorizeLocalSessionCommand({
          caller: caller({ sessionIds: ['worker'] }),
          payload,
        })
        yield* authorizeLocalSessionCommand({
          caller: caller({ hiveRootSessionIds: ['queen'] }),
          payload,
        })
        yield* authorizeLocalSessionCommand({
          caller: caller({ projectPaths: ['/project'] }),
          payload,
        })
        return denied
      }).pipe(Effect.provide(layer)),
    )

    expect(exactError).toMatchObject({ code: 'target_scope_denied' })
  })
})
