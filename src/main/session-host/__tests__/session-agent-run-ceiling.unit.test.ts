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
  readonly sessionCeiling?: 'yolo' | 'ask-for-approval'
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
        yield* sql.unsafe(
          'CREATE TABLE session_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_json TEXT)',
        )
        yield* sql.unsafe(
          'CREATE TABLE session_execution_profiles (session_id TEXT PRIMARY KEY, authorization_ceiling TEXT NOT NULL)',
        )
        yield* sql.unsafe(`CREATE TABLE session_client_profiles (
          id TEXT PRIMARY KEY, authorization_ceiling TEXT NOT NULL, revoked_at INTEGER
        )`)
        yield* sql`INSERT INTO session_client_profiles (id, authorization_ceiling, revoked_at) VALUES
          (${'asker'}, ${'ask-for-approval'}, ${null}),
          (${'trusted'}, ${'yolo'}, ${null}),
          (${'revoked'}, ${'yolo'}, ${1})`
        for (const run of runs) {
          yield* sql`INSERT INTO session_runs (id, session_id, intent_json) VALUES (
            ${run.runId}, ${run.sessionId}, ${JSON.stringify({ callerId: run.callerId })}
          )`
          yield* sql`INSERT OR IGNORE INTO session_execution_profiles (
            session_id, authorization_ceiling
          ) VALUES (${run.sessionId}, ${run.sessionCeiling ?? 'yolo'})`
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

  it('treats a revoked, unknown, or missing initiator as ask-for-approval', async () => {
    await expect(
      ceiling([{ sessionId: 's', runId: 'r', callerId: 'profile:revoked' }], 's', 'r'),
    ).resolves.toBe('ask-for-approval')
    await expect(
      ceiling([{ sessionId: 's', runId: 'r', callerId: 'transient-mcp:a' }], 's', 'r'),
    ).resolves.toBe('ask-for-approval')
    await expect(ceiling([], 's', 'missing')).resolves.toBe('ask-for-approval')
  })
})
