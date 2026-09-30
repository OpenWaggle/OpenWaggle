import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { runInitiatorCeiling } from '../session-agent-run-ceiling'

interface RunRow {
  readonly sessionId: string
  readonly runId: string
  readonly callerId: string
  readonly status?: string
  /** The Session's own origin; `profile:<id>` binds it to that profile's live ceiling. */
  readonly origin?: string
}

describe('runInitiatorCeiling', () => {
  let root = ''
  let databaseCount = 0

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-run-ceiling-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  function ceiling(runs: readonly RunRow[], sessionId: string, runId: string) {
    databaseCount += 1
    const database = SqliteClient.layer({
      filename: path.join(root, `ceiling-${databaseCount}.sqlite`),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`CREATE TABLE session_runs (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL,
          intent_json TEXT, created_at INTEGER NOT NULL
        )`)
        yield* sql.unsafe(`CREATE TABLE session_execution_profiles (
          session_id TEXT PRIMARY KEY, authorization_ceiling TEXT NOT NULL,
          authority_origin_caller_id TEXT NOT NULL
        )`)
        yield* sql.unsafe(
          'CREATE TABLE session_spawn_lineage (child_session_id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL)',
        )
        yield* sql.unsafe(
          'CREATE TABLE session_lineage (session_id TEXT PRIMARY KEY, parent_session_id TEXT)',
        )
        yield* sql.unsafe(`CREATE TABLE derived_child_management_grants (
          child_session_id TEXT PRIMARY KEY, authorization_ceiling TEXT NOT NULL, revoked_at INTEGER
        )`)
        yield* sql.unsafe(`CREATE TABLE session_client_profiles (
          id TEXT PRIMARY KEY, authorization_ceiling TEXT NOT NULL, revoked_at INTEGER
        )`)
        yield* sql`INSERT INTO session_client_profiles (id, authorization_ceiling, revoked_at) VALUES
          (${'asker'}, ${'ask-for-approval'}, ${null}),
          (${'trusted'}, ${'yolo'}, ${null}),
          (${'revoked'}, ${'yolo'}, ${1})`
        for (const [index, run] of runs.entries()) {
          yield* sql`INSERT INTO session_runs (id, session_id, status, intent_json, created_at)
            VALUES (${run.runId}, ${run.sessionId}, ${run.status ?? 'active'},
              ${JSON.stringify({ callerId: run.callerId })}, ${index})`
          yield* sql`INSERT OR IGNORE INTO session_execution_profiles (
            session_id, authorization_ceiling, authority_origin_caller_id
          ) VALUES (${run.sessionId}, ${'yolo'}, ${run.origin ?? 'gui:local-user'})`
        }
        return yield* runInitiatorCeiling(sql, sessionId, runId)
      }).pipe(Effect.provide(database)),
    )
  }

  it('follows the ceiling of the caller that started the Run', async () => {
    await expect(
      ceiling([{ sessionId: 's', runId: 'r', callerId: 'gui:local-user' }], 's', 'r'),
    ).resolves.toBe('yolo')
    await expect(
      ceiling([{ sessionId: 's', runId: 'r', callerId: 'profile:trusted' }], 's', 'r'),
    ).resolves.toBe('yolo')
    // An ask-for-approval profile messaged a yolo Session: its agent must not act as yolo.
    await expect(
      ceiling([{ sessionId: 's', runId: 'r', callerId: 'profile:asker' }], 's', 'r'),
    ).resolves.toBe('ask-for-approval')
  })

  it('carries an ask-for-approval initiator through a chain of agents', async () => {
    const runs = [
      { sessionId: 'first', runId: 'run-first', callerId: 'profile:asker' },
      { sessionId: 's', runId: 'r', callerId: 'session-agent:first:run-first' },
    ]
    await expect(ceiling(runs, 's', 'r')).resolves.toBe('ask-for-approval')
  })

  it('applies the live ceiling of the profile an initiating agent came from', async () => {
    // Session A came from profile asker (lowered to ask after A was created); the user typed in A.
    const runs = [
      { sessionId: 'a', runId: 'run-a', callerId: 'gui:local-user', origin: 'profile:asker' },
      { sessionId: 'b', runId: 'run-b', callerId: 'session-agent:a:run-a' },
    ]
    await expect(ceiling(runs, 'b', 'run-b')).resolves.toBe('ask-for-approval')
  })

  it('treats a revoked or unknown initiator as ask-for-approval', async () => {
    await expect(
      ceiling([{ sessionId: 's', runId: 'r', callerId: 'profile:revoked' }], 's', 'r'),
    ).resolves.toBe('ask-for-approval')
    await expect(
      ceiling([{ sessionId: 's', runId: 'r', callerId: 'transient-mcp:a' }], 's', 'r'),
    ).resolves.toBe('ask-for-approval')
  })

  it('bounds a Waggle Run, which has no row, by the active classic Run it runs in', async () => {
    const classic = [{ sessionId: 's', runId: 'classic', callerId: 'profile:asker' }]
    await expect(ceiling(classic, 's', 'waggle-s')).resolves.toBe('ask-for-approval')
    // An explicit Waggle the GUI started, with no classic Run, keeps the Session's own ceiling.
    await expect(ceiling([], 's', 'waggle-explicit')).resolves.toBe('yolo')
  })
})
