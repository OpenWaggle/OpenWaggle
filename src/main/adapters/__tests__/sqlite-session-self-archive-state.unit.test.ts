import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SessionOrganizationRepository,
  type SessionOrganizationRepositoryShape,
} from '../../ports/session-organization-repository'
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

  /** Runs `test` against a store whose target Session has an earlier and an asking Run. */
  function withAskingRun<A>(
    test: (input: {
      readonly sql: SqlClient.SqlClient
      readonly read: (
        runId: string,
      ) => ReturnType<SessionOrganizationRepositoryShape['readSelfArchiveState']>
    }) => Effect.Effect<A, unknown, SqlClient.SqlClient | SessionOrganizationRepository>,
  ) {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'host.sqlite'))
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const repository = yield* SessionOrganizationRepository
        yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'session-other'}, ${'/p'})`
        yield* insertRun(sql, 'run-earlier', 'session-target', 'completed')
        yield* insertRun(sql, 'run-asking', 'session-target', 'completed')
        // Another Session's later Run does not count for this one.
        yield* insertRun(sql, 'run-elsewhere', 'session-other', 'active')
        return yield* test({
          sql,
          read: (runId) => repository.readSelfArchiveState({ sessionId: 'session-target', runId }),
        })
      }).pipe(Effect.provide(layer)),
    )
  }

  const base = {
    archived: false,
    activeRunId: null,
    queuedFollowUpCount: 0,
    pendingWorkerUpdateCount: 0,
    workingDelegationCount: 0,
    pinned: false,
  }

  it('reads the asking Run and the Runs after it in the same Session', async () => {
    const result = await withAskingRun(({ read }) =>
      Effect.gen(function* () {
        const repository = yield* SessionOrganizationRepository
        return {
          idle: yield* read('run-asking'),
          fromEarlier: yield* read('run-earlier'),
          missing: yield* read('run-missing'),
          elsewhere: yield* read('run-elsewhere'),
          gone: yield* repository.readSelfArchiveState({
            sessionId: 'session-gone',
            runId: 'run-asking',
          }),
        }
      }),
    )

    expect(result.idle).toEqual({ ...base, runStatus: 'completed', laterRunCount: 0 })
    expect(result.fromEarlier).toEqual({ ...base, runStatus: 'completed', laterRunCount: 1 })
    expect(result.missing).toEqual({ ...base, runStatus: null, laterRunCount: 0 })
    expect(result.elsewhere).toEqual({ ...base, runStatus: null, laterRunCount: 0 })
    expect(result.gone).toBe(null)
  })

  it('reads the work, pins and Workers that keep the Session', async () => {
    const busy = await withAskingRun(({ sql, read }) =>
      Effect.gen(function* () {
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
        yield* sql`
          INSERT INTO pinned_sessions (session_id, pinned_at, sort_key)
          VALUES (${'session-target'}, ${1}, ${'a'})
        `
        for (const [id, state] of [
          ['delegation-working', 'working'],
          ['delegation-waiting', 'waiting'],
          ['delegation-revising', 'revision_requested'],
          ['delegation-review', 'ready_for_review'],
          ['delegation-asking', 'needs_attention'],
          ['delegation-accepted', 'accepted'],
        ] as const) {
          yield* sql`INSERT INTO sessions (id, project_path) VALUES (${`child-${id}`}, ${'/p'})`
          yield* sql`
            INSERT INTO delegation_contracts (
              id, parent_session_id, child_session_id, state, current_specification_revision,
              created_at, updated_at
            ) VALUES (${id}, ${'session-target'}, ${`child-${id}`}, ${state}, ${1}, ${1}, ${1})
          `
        }
        // A Worker that asked for help keeps running; one waiting for review does not count.
        yield* sql`
          INSERT INTO session_control_states (
            session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
          ) VALUES (
            ${'child-delegation-asking'}, ${1}, ${'run-worker-live'}, ${'running'}, ${0}, ${1}
          )
        `
        return yield* read('run-asking')
      }),
    )

    expect(busy).toEqual({
      archived: true,
      activeRunId: 'run-earlier',
      queuedFollowUpCount: 1,
      runStatus: 'completed',
      laterRunCount: 0,
      pendingWorkerUpdateCount: 1,
      workingDelegationCount: 4,
      pinned: true,
    })
  })
})
