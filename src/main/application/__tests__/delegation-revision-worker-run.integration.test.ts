import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionControlMutationRequest } from '@shared/types/session-control'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  QUEEN_CALLER_ID,
  seedHiveWorker,
} from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import {
  expectRevisionPrompt,
  FEEDBACK,
  REVISED_SPECIFICATION,
  recordingExecutor,
  waitFor,
  workerDelegation,
  workerWork,
} from './delegation-revision.test-support'
import {
  commandHostLayer,
  controlCommandAs,
  seedQueenAuthority,
  useHiveHostTestContext,
  waitForSessionIdle,
} from './hive-worker-cleanup-host.test-harness'

describe('a Delegation revision request reaches the Worker through the Session Host', () => {
  const host = useHiveHostTestContext('openwaggle-delegation-revision-run-')

  it.each([
    [
      'feedback only',
      {
        operation: 'delegation-request-revision',
        sessionId: 'queen',
        delegationId: 'delegation-worker',
        submissionRevision: 1,
        feedback: FEEDBACK,
      },
    ],
    [
      'a revised specification',
      {
        operation: 'delegation-request-revision',
        sessionId: 'queen',
        delegationId: 'delegation-worker',
        submissionRevision: 1,
        feedback: FEEDBACK,
        revisedSpecification: REVISED_SPECIFICATION,
      },
    ],
  ] satisfies readonly (readonly [string, SessionControlMutationRequest['command']])[])(
    'starts a Run on an idle Worker for a revision request with %s',
    async (_label, command) => {
      const recorder = recordingExecutor()
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* seedHiveWorker(sql, { state: 'ready_for_review' })
          yield* seedQueenAuthority(sql, host.temporaryRoot)
          const revision = yield* controlCommandAs(QUEEN_CALLER_ID, 'queen-revision', command)
          const workAfterReview = yield* workerWork(sql)
          yield* waitFor(() => recorder.runs.length === 1)
          yield* waitForSessionIdle('worker')
          return {
            revision: revision.outcome,
            workAfterReview,
            delegation: yield* workerDelegation(sql),
          }
        }).pipe(
          Effect.provide(
            commandHostLayer(path.join(host.temporaryRoot, 'idle.sqlite'), recorder.executor),
          ),
        ),
      )

      expect(result.revision).toMatchObject({
        effect: 'delegation-updated',
        delegationState: 'revision_requested',
      })
      // The Worker that `nextActor: worker` points at has work the moment the review returns.
      expect(result.workAfterReview.activeRunId).not.toBeNull()
      expect(recorder.runs).toHaveLength(1)
      expect(recorder.runs[0]?.sessionId).toBe('worker')
      expect(recorder.runs[0]?.intent.callerId).toBe(QUEEN_CALLER_ID)
      expectRevisionPrompt(recorder.runs[0]?.intent.text, {
        submissionRevision: 1,
        feedback: FEEDBACK,
      })
      // The revising Run's reply is the next revision for the parent to review.
      expect(result.delegation.state).toBe('ready_for_review')
      expect(result.delegation.submissions.map((row) => row.revision)).toEqual([1, 2])
      expect(result.delegation.submissions[1]?.source_run_id).toBe(recorder.runs[0]?.runId)
    },
  )

  it('starts a Run on an idle Worker whose accepted Delegation the parent reopens', async () => {
    const recorder = recordingExecutor()
    const reason = 'The error path is still missing.'
    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'accepted' })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
        const reopened = yield* controlCommandAs(QUEEN_CALLER_ID, 'queen-reopen', {
          operation: 'delegation-reopen',
          sessionId: 'queen',
          delegationId: 'delegation-worker',
          reason,
        })
        expect(reopened.outcome).toMatchObject({ delegationState: 'revision_requested' })
        yield* waitFor(() => recorder.runs.length === 1)
        yield* waitForSessionIdle('worker')
      }).pipe(
        Effect.provide(
          commandHostLayer(path.join(host.temporaryRoot, 'reopen.sqlite'), recorder.executor),
        ),
      ),
    )

    expect(recorder.runs[0]?.sessionId).toBe('worker')
    expectRevisionPrompt(recorder.runs[0]?.intent.text, { submissionRevision: 1, feedback: reason })
  })

  it('queues the revision request after a busy Worker’s current Run', async () => {
    const holdFirstRun = Effect.runSync(Deferred.make<void>())
    const recorder = recordingExecutor({ holdFirstRun })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'ready_for_review' })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
        const started = yield* controlCommandAs(QUEEN_CALLER_ID, 'queen-start', {
          operation: 'start',
          sessionId: 'worker',
          input: { text: 'Tidy up the notes.', attachmentIds: [] },
        })
        yield* waitFor(() => recorder.runs.length === 1)
        const revision = yield* controlCommandAs(QUEEN_CALLER_ID, 'queen-revision', {
          operation: 'delegation-request-revision',
          sessionId: 'queen',
          delegationId: 'delegation-worker',
          submissionRevision: 1,
          feedback: FEEDBACK,
        })
        const workWhileBusy = yield* workerWork(sql)
        const runsWhileBusy = recorder.runs.length
        // The current Run's agent, which never saw the feedback, tries to submit anyway.
        const staleSubmit = yield* controlCommandAs(
          `session-agent:worker:${recorder.runs[0]?.runId ?? ''}`,
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
        return {
          started: started.outcome.effect,
          revision: revision.outcome,
          workWhileBusy,
          runsWhileBusy,
          staleSubmit: staleSubmit.outcome,
          delegation: yield* workerDelegation(sql),
          workAfter: yield* workerWork(sql),
        }
      }).pipe(
        Effect.provide(
          commandHostLayer(path.join(host.temporaryRoot, 'busy.sqlite'), recorder.executor),
        ),
      ),
    )

    expect(result.started).toBe('started-run')
    expect(result.revision).toMatchObject({ delegationState: 'revision_requested' })
    // Not steered into the current Run: queued behind it.
    expect(result.runsWhileBusy).toBe(1)
    expect(result.workWhileBusy.activeRunId).toBe(recorder.runs[0]?.runId)
    expect(result.workWhileBusy.queuedTexts).toHaveLength(1)
    expectRevisionPrompt(result.workWhileBusy.queuedTexts[0], {
      submissionRevision: 1,
      feedback: FEEDBACK,
    })
    expect(result.staleSubmit).toMatchObject({
      effect: 'rejected',
      code: 'delegation_revision_pending',
    })
    expect(recorder.runs[1]?.sessionId).toBe('worker')
    expectRevisionPrompt(recorder.runs[1]?.intent.text, {
      submissionRevision: 1,
      feedback: FEEDBACK,
    })
    // The Run that never saw the feedback is not taken as the revision; the revising Run is.
    expect(result.delegation.state).toBe('ready_for_review')
    expect(result.delegation.submissions.map((row) => row.revision)).toEqual([1, 2])
    expect(result.delegation.submissions[1]?.source_run_id).toBe(recorder.runs[1]?.runId)
    expect(result.workAfter).toEqual({ activeRunId: null, queuedTexts: [] })
  })
})
