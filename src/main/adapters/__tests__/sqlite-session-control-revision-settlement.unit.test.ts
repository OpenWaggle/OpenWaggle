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

/**
 * A Run that started before its parent sent the Worker back to work never saw the feedback, so
 * its reply is not the revision, even when it settles before the revision request is queued
 * (#454: the parent's change commits first, then its Follow-up is queued as its own command).
 */
describe('SQLite Worker settlement after a revision request', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-revision-settlement-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  function settleAfterRevisionRequest(file: string, requestedAfterRunStartMs: number) {
    const layer = makeSessionControlRunLifecycleTestLayer(path.join(temporaryRoot, file))
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* prepareWorkerDelegation(sql)
        yield* startWorkerRun
        const lifecycle = yield* SessionControlRunLifecycleRepository
        yield* lifecycle.activate({ sessionId: SessionId('worker'), runId: RunId('run-next') })
        const [run] = yield* sql<{ readonly created_at: number }>`
          SELECT created_at FROM session_runs WHERE id = ${'run-next'}
        `
        yield* sql`
          INSERT INTO delegation_state_transitions (
            delegation_id, from_state, to_state, reason, actor_session_id, authored_by, created_at
          ) VALUES (
            ${'delegation-worker'}, ${'ready_for_review'}, ${'revision_requested'},
            ${'Cover the error path too.'}, ${'queen'}, ${'session-agent:queen:run-queen'},
            ${(run?.created_at ?? 0) + requestedAfterRunStartMs}
          )
        `
        yield* sql`
          UPDATE delegation_contracts SET state = ${'revision_requested'}
          WHERE id = ${'delegation-worker'}
        `
        // No Follow-up is queued yet: the parent's change committed, its Follow-up has not.
        const settlement = yield* lifecycle.settle({
          sessionId: SessionId('worker'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
          finalResponse: 'Done, without the error path.',
        })
        const [contract] = yield* sql<{ readonly state: string }>`
          SELECT state FROM delegation_contracts WHERE id = ${'delegation-worker'}
        `
        const [submissions] = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM delegation_submissions
          WHERE delegation_id = ${'delegation-worker'}
        `
        return { settlement, state: contract?.state, submissions: submissions?.count }
      }).pipe(Effect.provide(layer)),
    )
  }

  it('does not capture the reply of a Run that started before the revision request', async () => {
    const result = await settleAfterRevisionRequest('before.sqlite', 1)

    expect(result.settlement).not.toHaveProperty('delegationUpdate')
    expect(result.state).toBe('revision_requested')
    expect(result.submissions).toBe(0)
  })

  it('captures the reply of a Run that started after the revision request', async () => {
    const result = await settleAfterRevisionRequest('after.sqlite', -1)

    expect(result.settlement).toMatchObject({
      delegationUpdate: { state: 'ready_for_review', submissionRevision: 1 },
    })
    expect(result.state).toBe('ready_for_review')
    expect(result.submissions).toBe(1)
  })
})
