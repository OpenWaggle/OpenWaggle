import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { delegationRevisionKey } from '../../domain/session-control/delegation-revision-follow-up'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import {
  makeSessionControlRunLifecycleTestLayer,
  prepareWorkerDelegation,
  startWorkerRun,
} from './sqlite-session-control-run-lifecycle-test-layer'

/**
 * A Run that started before its parent sent the Worker back to work never saw the feedback, so
 * its reply is not the revision while that revision request is not queued yet (#454: the parent's
 * command commits first, then its Follow-up is queued as its own command).
 */
describe('SQLite Worker settlement after a revision request', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-revision-settlement-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  const QUEEN_CALLER = 'session-agent:queen:run-queen'

  interface SendBack {
    readonly operation: 'delegation-request-revision' | 'delegation-amend'
    /** Milliseconds after the settling Run started; negative for a command before it. */
    readonly afterRunStartMs: number
    /** Whether the outcome says it sent a waiting Worker back (a task change's `revisionRequest`). */
    readonly sendsBack?: boolean
    /** Whether its revision Follow-up was recorded on the Worker, then promoted into the Run. */
    readonly followUpRecorded?: boolean
  }

  function settleAfterSendBack(file: string, sendBack: SendBack) {
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
        const at = (run?.created_at ?? 0) + sendBack.afterRunStartMs
        const outcome = {
          operation: sendBack.operation,
          delegationId: 'delegation-worker',
          workerSessionId: 'worker',
          delegationState: 'revision_requested',
          ...(sendBack.operation === 'delegation-amend' && sendBack.sendsBack !== false
            ? { revisionRequest: { parentSessionId: 'queen', submissionRevision: 1 } }
            : {}),
        }
        yield* sql`
          INSERT INTO session_operations (
            caller_id, operation, target_scope, idempotency_key, request_json,
            status, outcome_json, created_at, updated_at
          ) VALUES (
            ${QUEEN_CALLER}, ${sendBack.operation}, ${'delegation:delegation-worker:actor:queen'},
            ${'queen-key'}, ${'{}'}, ${'completed'}, ${JSON.stringify(outcome)}, ${at}, ${at}
          )
        `
        if (sendBack.followUpRecorded) {
          yield* sql`
            INSERT INTO session_operations (
              caller_id, operation, target_scope, idempotency_key, request_json,
              status, outcome_json, created_at, updated_at
            ) VALUES (
              ${QUEEN_CALLER}, ${'follow-up'}, ${'worker'},
              ${delegationRevisionKey(sendBack.operation, 'queen-key')}, ${'{}'},
              ${'completed'}, ${'{}'}, ${at}, ${at}
            )
          `
        }
        yield* sql`
          UPDATE delegation_contracts SET state = ${'revision_requested'}
          WHERE id = ${'delegation-worker'}
        `
        // Nothing is queued on the Worker: the Follow-up is not committed yet, or was promoted.
        const settlement = yield* lifecycle.settle({
          sessionId: SessionId('worker'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
          finalResponse: 'Done.',
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

  it('holds back the reply of a Run settling before its revision request is queued', async () => {
    const result = await settleAfterSendBack('owed.sqlite', {
      operation: 'delegation-request-revision',
      afterRunStartMs: 1,
    })

    expect(result.settlement).not.toHaveProperty('delegationUpdate')
    expect(result.state).toBe('revision_requested')
    expect(result.submissions).toBe(0)
  })

  it.each([
    [
      'once the revision request was recorded and promoted into the Run',
      { operation: 'delegation-request-revision', afterRunStartMs: 1, followUpRecorded: true },
    ],
    [
      'for a Run started after the revision request, such as a retry after a failed one',
      { operation: 'delegation-request-revision', afterRunStartMs: -1 },
    ],
    [
      'for a task change that sent no revision request (a Worker still on the task)',
      { operation: 'delegation-amend', afterRunStartMs: 1, sendsBack: false },
    ],
  ] satisfies readonly (readonly [string, SendBack])[])(
    'captures the reply %s',
    async (label, sendBack) => {
      const result = await settleAfterSendBack(`${label.length}.sqlite`, sendBack)

      expect(result.settlement).toMatchObject({
        delegationUpdate: { state: 'ready_for_review', submissionRevision: 1 },
      })
      expect(result.state).toBe('ready_for_review')
      expect(result.submissions).toBe(1)
    },
  )

  it('holds back a task change that sent a waiting Worker back, until its request is queued', async () => {
    const result = await settleAfterSendBack('amend.sqlite', {
      operation: 'delegation-amend',
      afterRunStartMs: 1,
    })

    expect(result.state).toBe('revision_requested')
    expect(result.submissions).toBe(0)
  })
})
