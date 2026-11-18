import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlDelegationMutationRequest,
} from '@shared/types/session-control'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  QUEEN_CALLER_ID,
  seedHiveWorker,
} from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import { delegationRevisionFollowUp } from '../../domain/session-control/delegation-revision-follow-up'
import { executeSessionControlMutation } from '../session-control-command-service'
import { executeSessionDelegationMutation } from '../session-delegation-service'
import {
  FEEDBACK,
  recordingExecutor,
  waitFor,
  workerDelegation,
} from './delegation-revision.test-support'
import {
  commandHostLayer,
  controlCommandAs,
  seedQueenAuthority,
  useHiveHostTestContext,
  waitForSessionIdle,
} from './hive-worker-cleanup-host.test-harness'

const REVIEW: SessionControlDelegationMutationRequest = {
  contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
  requestId: 'queen-revision',
  idempotencyKey: 'queen-revision',
  command: {
    operation: 'delegation-request-revision',
    sessionId: 'queen',
    delegationId: 'delegation-worker',
    submissionRevision: 1,
    feedback: FEEDBACK,
  },
}

/**
 * The parent's review commits before its revision request is queued on the Worker (#454), so
 * another Run may start on the Worker in between and the request then queues behind it. That Run
 * never saw the feedback either, so it may not submit its result as the revision.
 */
describe('a Worker Run that started after the review but before its revision request', () => {
  const host = useHiveHostTestContext('openwaggle-delegation-revision-gap-')

  it.each([
    ['its agent', (runId: string) => `session-agent:worker:${runId}`],
    ['a Waggle it requested', (runId: string) => `session-agent:worker:waggle-of-${runId}`],
  ] as const)(
    'may not submit, as %s, while the revision request waits behind it',
    async (label, submitter) => {
      const holdFirstRun = Effect.runSync(Deferred.make<void>())
      const recorder = recordingExecutor({ holdFirstRun })
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* seedHiveWorker(sql, { state: 'ready_for_review' })
          yield* seedQueenAuthority(sql, host.temporaryRoot)
          // The review alone: its revision request is not queued yet.
          const review = yield* executeSessionDelegationMutation({
            callerId: QUEEN_CALLER_ID,
            request: REVIEW,
          })
          yield* Effect.sleep('5 millis')
          yield* controlCommandAs(QUEEN_CALLER_ID, 'queen-start', {
            operation: 'start',
            sessionId: 'worker',
            input: { text: 'Tidy up the notes.', attachmentIds: [] },
          })
          yield* waitFor(() => recorder.runs.length === 1)
          const followUp = delegationRevisionFollowUp(REVIEW, review)
          if (!followUp) throw new Error('The review sent no revision request.')
          yield* executeSessionControlMutation({ callerId: QUEEN_CALLER_ID, request: followUp })
          const staleSubmit = yield* controlCommandAs(
            submitter(recorder.runs[0]?.runId ?? ''),
            'worker-stale-submit',
            {
              operation: 'delegation-submit',
              sessionId: 'worker',
              delegationId: 'delegation-worker',
              summary: 'Done, without the error path.',
              evidence: [],
            },
          )
          yield* Deferred.succeed(holdFirstRun, undefined)
          yield* waitFor(() => recorder.runs.length === 2)
          yield* waitForSessionIdle('worker')
          return { staleSubmit: staleSubmit.outcome, delegation: yield* workerDelegation(sql) }
        }).pipe(
          Effect.provide(
            commandHostLayer(
              path.join(host.temporaryRoot, `${label.length}.sqlite`),
              recorder.executor,
            ),
          ),
        ),
      )

      expect(result.staleSubmit).toMatchObject({
        effect: 'rejected',
        code: 'delegation_revision_pending',
      })
      // The Run that read the revision request produced the revision.
      expect(result.delegation.state).toBe('ready_for_review')
      expect(result.delegation.submissions.map((row) => row.revision)).toEqual([1, 2])
      expect(result.delegation.submissions[1]?.source_run_id).toBe(recorder.runs[1]?.runId)
    },
  )
})
