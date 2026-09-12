import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { submitSessionMessage } from '../../application/session-control-service'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

describe('SQLite direct Worker Run admission', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-parent-admission-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('enforces the parent limit when an existing idle Worker starts again', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'parent-admission.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`CREATE TABLE settings_store (
          key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL
        )`)
        yield* sql`
          INSERT INTO settings_store (key, value_json, updated_at)
          VALUES (${'sessionHostParentConcurrencyLimit'}, ${'1'}, ${1})
        `
        yield* sql`
          INSERT INTO sessions (id, project_path) VALUES
            (${'queen'}, ${'/project'}), (${'worker-active'}, ${'/project'})
        `
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
          VALUES
            (${'run-queen'}, ${'queen'}, ${'active'}, ${null}, ${1}, ${1}),
            (${'run-worker-active'}, ${'worker-active'}, ${'active'}, ${null}, ${1}, ${1})
        `
        yield* sql`
          INSERT INTO session_control_states (
            session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
          ) VALUES
            (${'queen'}, ${1}, ${'run-queen'}, ${'running'}, ${0}, ${1}),
            (${'worker-active'}, ${1}, ${'run-worker-active'}, ${'running'}, ${0}, ${1})
        `
        yield* sql`
          INSERT INTO session_spawn_lineage (
            child_session_id, parent_session_id, parent_run_id,
            hive_root_session_id, depth, created_at
          ) VALUES
            (${'session-target'}, ${'queen'}, ${'run-queen'}, ${'queen'}, ${1}, ${1}),
            (${'worker-active'}, ${'queen'}, ${'run-queen'}, ${'queen'}, ${1}, ${2})
        `
        const response = yield* submitSessionMessage({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-existing-worker',
            idempotencyKey: 'idempotency-existing-worker',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Start another Worker Run.', attachmentIds: [] },
            },
          },
        })
        const targetRuns = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_runs WHERE session_id = ${'session-target'}
        `
        return { response, targetRuns: targetRuns[0]?.count }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({
      operation: 'message',
      effect: 'rejected',
      code: 'parent_concurrency_limit_reached',
    })
    expect(result.targetRuns).toBe(0)
  })
})
