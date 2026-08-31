import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  fenceLocalSessionProfileBackgroundWork,
  releaseLocalSessionProfileBackgroundWorkFence,
} from '../../application/local-session-profile-background-work'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import {
  admitSessionToolMutation,
  admitSessionToolObservation,
} from '../session-tool-mutation-admission'

describe('Sessions tool mutation admission', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-tool-admission-'))
  })

  afterEach(async () => {
    releaseLocalSessionProfileBackgroundWorkFence('origin-profile')
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('cancels observations, drains mutations, and re-resolves revoked Worker grants', async () => {
    const sqlite = SqliteClient.layer({
      filename: path.join(temporaryRoot, 'authority.sqlite'),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`CREATE TABLE sessions (id TEXT PRIMARY KEY, project_path TEXT)`)
        yield* sql.unsafe(`CREATE TABLE session_execution_profiles (
          session_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL,
          authority_origin_caller_id TEXT NOT NULL, authority_scope_snapshot_json TEXT,
          authorization_ceiling TEXT NOT NULL)`)
        yield* sql.unsafe(`CREATE TABLE session_spawn_lineage (
          child_session_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL,
          hive_root_session_id TEXT NOT NULL)`)
        yield* sql.unsafe(`CREATE TABLE derived_child_management_grants (
          id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL,
          child_session_id TEXT NOT NULL UNIQUE, source_caller_id TEXT NOT NULL,
          capabilities_json TEXT NOT NULL, authorization_ceiling TEXT NOT NULL,
          revoked_at INTEGER)`)
        yield* sql.unsafe(`CREATE TABLE session_client_profiles (
          id TEXT PRIMARY KEY, capabilities_json TEXT NOT NULL, scope_json TEXT NOT NULL,
          authorization_ceiling TEXT NOT NULL, revoked_at INTEGER)`)
        yield* sql`INSERT INTO sessions (id, project_path) VALUES
          (${'queen'}, ${temporaryRoot}), (${'worker'}, ${temporaryRoot})`
        yield* sql`INSERT INTO session_execution_profiles (
          session_id, profile_json, authority_origin_caller_id, authorization_ceiling
        ) VALUES (
          ${'worker'}, ${'{"modelId":"provider/model","thinkingLevel":"medium"}'},
          ${'profile:origin-profile'}, ${'ask-for-approval'})`
        yield* sql`INSERT INTO session_spawn_lineage (
          child_session_id, parent_session_id, hive_root_session_id
        ) VALUES (${'worker'}, ${'queen'}, ${'queen'})`
        yield* sql`INSERT INTO derived_child_management_grants (
          id, parent_session_id, child_session_id, source_caller_id,
          capabilities_json, authorization_ceiling, revoked_at
        ) VALUES (
          ${'grant-worker'}, ${'queen'}, ${'worker'}, ${'profile:origin-profile'},
          ${'["sessions:message"]'}, ${'ask-for-approval'}, ${null})`
        yield* sql`INSERT INTO session_client_profiles (
          id, capabilities_json, scope_json, authorization_ceiling, revoked_at
        ) VALUES (
          ${'origin-profile'}, ${'["sessions:message"]'}, ${'{"all":true}'},
          ${'ask-for-approval'}, ${null})`

        const observation = yield* Effect.promise(() =>
          admitSessionToolObservation({
            sql,
            sessionId: 'worker',
            runId: 'run-worker',
            workingDirectory: temporaryRoot,
          }),
        )
        let observationFenceSettled = false
        const observationFence = fenceLocalSessionProfileBackgroundWork('origin-profile').then(
          () => {
            observationFenceSettled = true
          },
        )
        yield* Effect.promise(() => Promise.resolve())
        expect(observation.signal?.aborted).toBe(true)
        expect(observationFenceSettled).toBe(false)
        observation.release()
        yield* Effect.promise(() => observationFence)
        releaseLocalSessionProfileBackgroundWorkFence('origin-profile')

        const admission = yield* Effect.promise(() =>
          admitSessionToolMutation({
            sql,
            sessionId: 'worker',
            runId: 'run-worker',
            workingDirectory: temporaryRoot,
          }),
        )
        let fenceSettled = false
        const fenced = fenceLocalSessionProfileBackgroundWork('origin-profile').then(() => {
          fenceSettled = true
        })
        yield* Effect.promise(() => Promise.resolve())
        expect(fenceSettled).toBe(false)
        admission.release()
        yield* Effect.promise(() => fenced)
        yield* sql`UPDATE derived_child_management_grants SET revoked_at = ${1}
          WHERE id = ${'grant-worker'}`
        releaseLocalSessionProfileBackgroundWorkFence('origin-profile')

        yield* Effect.promise(() =>
          expect(
            admitSessionToolMutation({
              sql,
              sessionId: 'worker',
              runId: 'run-worker',
              workingDirectory: temporaryRoot,
            }),
          ).rejects.toThrow('management grant was revoked'),
        )
      }).pipe(Effect.provide(sqlite)),
    )
  })
})
