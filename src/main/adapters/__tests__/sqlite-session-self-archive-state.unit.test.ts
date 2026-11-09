import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionOrganizationRepository } from '../../ports/session-organization-repository'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

function insertRun(sql: SqlClient.SqlClient, id: string, sessionId: string, status: string) {
  return sql`
    INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
    VALUES (${id}, ${sessionId}, ${status}, ${null}, ${1000}, ${1000})
  `
}

describe('SQLite self-archive state', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-self-archive-state-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('reads the asking Run, the Runs after it in the same Session, and queued Follow-ups', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'host.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const repository = yield* SessionOrganizationRepository
        const read = (runId: string) =>
          repository.readSelfArchiveState({ sessionId: 'session-target', runId })
        yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'session-other'}, ${'/p'})`
        yield* insertRun(sql, 'run-earlier', 'session-target', 'completed')
        yield* insertRun(sql, 'run-asking', 'session-target', 'completed')
        // Another Session's later Run does not count for this one.
        yield* insertRun(sql, 'run-elsewhere', 'session-other', 'active')
        const idle = yield* read('run-asking')
        const fromEarlier = yield* read('run-earlier')
        const missing = yield* read('run-missing')
        const elsewhere = yield* read('run-elsewhere')
        yield* sql`
          INSERT INTO session_follow_ups (
            id, session_id, position, delivery_state, intent_json, created_at, updated_at
          ) VALUES (${'follow-up'}, ${'session-target'}, ${0}, ${'pending'}, ${'{}'}, ${1}, ${1})
        `
        yield* sql`UPDATE sessions SET archived = ${1} WHERE id = ${'session-target'}`
        yield* sql`
          UPDATE session_control_states SET active_run_id = ${'run-earlier'}
          WHERE session_id = ${'session-target'}
        `
        // The read only counts pending updates; their Delegation and Worker rows do not matter.
        yield* sql.unsafe('PRAGMA foreign_keys = OFF')
        for (const [id, status] of [
          ['update-pending', 'pending'],
          ['update-delivered', 'delivered'],
        ] as const) {
          yield* sql`
            INSERT INTO session_orchestration_updates (
              id, parent_session_id, worker_session_id, delegation_id, source_run_id, state,
              summary, status, delivered_run_id, delivered_item_id, created_at, delivered_at
            ) VALUES (
              ${id}, ${'session-target'}, ${'worker'}, ${`delegation-${id}`}, ${'run-worker'},
              ${'ready_for_review'}, ${'Done.'}, ${status},
              ${status === 'delivered' ? 'run-asking' : null},
              ${status === 'delivered' ? 'item' : null}, ${1}, ${status === 'delivered' ? 2 : null}
            )
          `
        }
        const busy = yield* read('run-asking')
        const gone = yield* repository.readSelfArchiveState({
          sessionId: 'session-gone',
          runId: 'run-asking',
        })
        return { idle, fromEarlier, missing, elsewhere, busy, gone }
      }).pipe(Effect.provide(layer)),
    )

    const base = {
      archived: false,
      activeRunId: null,
      queuedFollowUpCount: 0,
      pendingWorkerUpdateCount: 0,
    }
    expect(result.idle).toEqual({ ...base, runStatus: 'completed', laterRunCount: 0 })
    expect(result.fromEarlier).toEqual({ ...base, runStatus: 'completed', laterRunCount: 1 })
    expect(result.missing).toEqual({ ...base, runStatus: null, laterRunCount: 0 })
    expect(result.elsewhere).toEqual({ ...base, runStatus: null, laterRunCount: 0 })
    expect(result.busy).toEqual({
      archived: true,
      activeRunId: 'run-earlier',
      queuedFollowUpCount: 1,
      runStatus: 'completed',
      laterRunCount: 0,
      pendingWorkerUpdateCount: 1,
    })
    expect(result.gone).toBe(null)
  })
})
