import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionControlMutationRequest } from '@shared/types/session-control'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Schedule from 'effect/Schedule'
import { describe, expect, it } from 'vitest'
import {
  QUEEN_CALLER_ID,
  seedHiveWorker,
} from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import type { SessionControlRunExecutionInput } from '../../ports/session-control-run-executor'
import {
  commandHostLayer,
  controlCommandAs,
  seedQueenAuthority,
  useHiveHostTestContext,
  waitForSessionIdle,
} from './hive-worker-cleanup-host.test-harness'

const FEEDBACK = 'Cover the error path too.'

const REVISED_SPECIFICATION = {
  objective: 'Review the tests, including the error path',
  deliverables: ['A list of missing error-path tests'],
  acceptanceCriteria: ['Every error path is named'],
  resourceReferences: [],
} as const

function recordingExecutor(options: { readonly holdFirstRun?: Deferred.Deferred<void> } = {}) {
  const runs: SessionControlRunExecutionInput[] = []
  return {
    runs,
    executor: {
      execute: (input: SessionControlRunExecutionInput) =>
        Effect.gen(function* () {
          runs.push(input)
          if (runs.length === 1 && options.holdFirstRun) yield* Deferred.await(options.holdFirstRun)
          return { terminalStatus: 'completed' as const, finalResponse: `Reply ${runs.length}.` }
        }),
    },
  }
}

function waitFor(condition: () => boolean) {
  return Effect.suspend(() => (condition() ? Effect.void : Effect.fail('pending' as const))).pipe(
    Effect.retry(Schedule.spaced('10 millis').pipe(Schedule.upTo('5 seconds'))),
  )
}

function workerDelegation(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const contract = yield* sql<{ readonly state: string }>`
      SELECT state FROM delegation_contracts WHERE id = ${'delegation-worker'}
    `
    const submissions = yield* sql<{ readonly revision: number; readonly source_run_id: string }>`
      SELECT revision, source_run_id FROM delegation_submissions
      WHERE delegation_id = ${'delegation-worker'} ORDER BY revision
    `
    return { state: contract[0]?.state, submissions }
  })
}

/** The Worker's queued and active work: what a `nextActor: worker` must stand on. */
function workerWork(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const control = yield* sql<{ readonly active_run_id: string | null }>`
      SELECT active_run_id FROM session_control_states WHERE session_id = ${'worker'}
    `
    const followUps = yield* sql<{ readonly intent_json: string }>`
      SELECT intent_json FROM session_follow_ups WHERE session_id = ${'worker'} ORDER BY position
    `
    return {
      activeRunId: control[0]?.active_run_id ?? null,
      queuedTexts: followUps.map((row) => {
        const intent: unknown = JSON.parse(row.intent_json)
        return typeof intent === 'object' && intent !== null && 'text' in intent
          ? String(intent.text)
          : ''
      }),
    }
  })
}

function expectRevisionPrompt(
  text: string | undefined,
  expected: { readonly submissionRevision: number; readonly feedback: string },
) {
  expect(text).toContain('OpenWaggle Host-authored Delegation revision request')
  expect(text).toContain('"delegationId":"delegation-worker"')
  expect(text).toContain(`"submissionRevision":${String(expected.submissionRevision)}`)
  expect(text).toContain(JSON.stringify(expected.feedback))
}

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

  it('sends nothing to the Worker for a reviewer that may not message it', async () => {
    const recorder = recordingExecutor()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'ready_for_review' })
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
        const revision = yield* controlCommandAs(QUEEN_CALLER_ID, 'queen-revision', {
          operation: 'delegation-request-revision',
          sessionId: 'queen',
          delegationId: 'delegation-worker',
          submissionRevision: 1,
          feedback: FEEDBACK,
        })
        return { revision: revision.outcome, work: yield* workerWork(sql) }
      }).pipe(
        Effect.provide(
          commandHostLayer(path.join(host.temporaryRoot, 'revoked.sqlite'), recorder.executor),
        ),
      ),
    )

    expect(result.revision).toMatchObject({ delegationState: 'revision_requested' })
    expect(result.work).toEqual({ activeRunId: null, queuedTexts: [] })
    expect(recorder.runs).toHaveLength(0)
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
        yield* Deferred.succeed(holdFirstRun, undefined)
        yield* waitFor(() => recorder.runs.length === 2)
        yield* waitForSessionIdle('worker')
        return {
          started: started.outcome.effect,
          revision: revision.outcome,
          workWhileBusy,
          runsWhileBusy,
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
