import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import {
  makeSessionControlRunLifecycleTestLayer,
  prepareWorkerDelegation,
  startWorkerRun,
} from './sqlite-session-control-run-lifecycle-test-layer'

interface UpdateRow {
  readonly id: string
  readonly state: string
  readonly summary: string
  readonly status: string
  readonly delivered_run_id: string | null
  readonly delivered_item_id: string | null
  readonly delivered_at: number | null
  readonly created_at: number
}

describe('SQLite Worker settlement after an explicit submission', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-worker-rearm-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('re-arms the update when the same Run submitted, was asked to revise, then replied', async () => {
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'worker-rearm.sqlite'),
    )
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* prepareWorkerDelegation(sql)
        yield* startWorkerRun
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({ sessionId: SessionId('worker'), runId: RunId('run-next') })
        // The Worker submitted through the Hive tool during this Run, the parent read the update,
        // and asked for a revision while the Run still worked.
        yield* sql`INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
          VALUES (${'run-queen'}, ${'queen'}, ${'completed'}, ${'{"callerId":"local-user"}'}, ${900}, ${900})`
        yield* sql`
          INSERT INTO session_orchestration_updates (
            id, parent_session_id, worker_session_id, delegation_id, source_run_id, state, summary,
            status, delivered_run_id, delivered_item_id, delivered_at, created_at
          ) VALUES (
            ${'orchestration:delegation-worker:run-next:submission-1'}, ${'queen'}, ${'worker'},
            ${'delegation-worker'}, ${'run-next'}, ${'ready_for_review'}, ${'First draft.'},
            ${'delivered'}, ${'run-queen'}, ${'item-1'}, ${1100}, ${1050}
          )
        `
        yield* sql`
          UPDATE delegation_contracts SET state = ${'revision_requested'}
          WHERE id = ${'delegation-worker'}
        `
        yield* lifecycle.settle({
          sessionId: SessionId('worker'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
          finalResponse: 'Revised draft with the requested sections.',
        })
        return yield* sql<UpdateRow>`
          SELECT id, state, summary, status, delivered_run_id, delivered_item_id, delivered_at,
            created_at
          FROM session_orchestration_updates WHERE delegation_id = ${'delegation-worker'}
        `
      }).pipe(Effect.provide(layer)),
    )

    // One row per Run and state: the reply replaces the read submission and is pending again,
    // so the parent hears about the revision instead of the settlement failing on the key.
    expect(rows).toEqual([
      {
        id: 'orchestration:delegation-worker:run-next:ready-for-review',
        state: 'ready_for_review',
        summary: 'Revised draft with the requested sections.',
        status: 'pending',
        delivered_run_id: null,
        delivered_item_id: null,
        delivered_at: null,
        created_at: expect.any(Number),
      },
    ])
    expect(rows[0]?.created_at).toBeGreaterThan(1050)
  })
})
