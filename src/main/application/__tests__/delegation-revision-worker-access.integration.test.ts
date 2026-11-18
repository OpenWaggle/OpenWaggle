import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionControlMutationRequest } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  QUEEN_CALLER_ID,
  seedHiveWorker,
} from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import {
  FEEDBACK,
  recordingExecutor,
  workerDelegation,
  workerWork,
} from './delegation-revision.test-support'
import {
  commandHostLayer,
  controlCommandAs,
  seedQueenAuthority,
  useHiveHostTestContext,
} from './hive-worker-cleanup-host.test-harness'

describe('a Delegation revision request needs a reviewer who may message the Worker', () => {
  const host = useHiveHostTestContext('openwaggle-delegation-revision-denied-')

  it.each([
    [
      'a revision request',
      'ready_for_review',
      {
        operation: 'delegation-request-revision',
        sessionId: 'queen',
        delegationId: 'delegation-worker',
        submissionRevision: 1,
        feedback: FEEDBACK,
      },
    ],
    [
      'a reopen',
      'accepted',
      {
        operation: 'delegation-reopen',
        sessionId: 'queen',
        delegationId: 'delegation-worker',
        reason: 'The error path is still missing.',
      },
    ],
  ] satisfies readonly (readonly [
    string,
    'ready_for_review' | 'accepted',
    SessionControlMutationRequest['command'],
  ])[])(
    'refuses %s from a reviewer that may not message the Worker, and changes nothing',
    async (_label, state, command) => {
      const recorder = recordingExecutor()
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* seedHiveWorker(sql, { state })
          yield* seedQueenAuthority(sql, host.temporaryRoot)
          // The Queen's agent may review its Worker but not message it.
          yield* sql`
            UPDATE session_execution_profiles
            SET profile_json = ${JSON.stringify({
              modelId: 'provider/model',
              thinkingLevel: 'medium',
              sessionCapabilities: ['delegations:review'],
            })}
            WHERE session_id = ${'queen'}
          `
          const review = yield* controlCommandAs(QUEEN_CALLER_ID, 'queen-review', command)
          return {
            review: review.outcome,
            delegation: yield* workerDelegation(sql),
            work: yield* workerWork(sql),
          }
        }).pipe(
          Effect.provide(
            commandHostLayer(path.join(host.temporaryRoot, 'denied.sqlite'), recorder.executor),
          ),
        ),
      )

      expect(result.review).toMatchObject({
        effect: 'rejected',
        code: 'worker_message_denied',
        kind: 'authorization',
      })
      expect(result.delegation.state).toBe(state)
      expect(result.work).toEqual({ activeRunId: null, queuedTexts: [] })
      expect(recorder.runs).toHaveLength(0)
    },
  )
})
