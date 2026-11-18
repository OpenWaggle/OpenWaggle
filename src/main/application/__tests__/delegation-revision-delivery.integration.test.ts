import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type {
  LocalSessionCallerIdentity,
  LocalSessionProfileScope,
} from '@shared/types/local-session-profile'
import type { SessionCapability } from '@shared/types/session-capability'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  QUEEN_CALLER_ID,
  seedHiveWorker,
} from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import { executeSessionControlMutation } from '../session-control-command-service'
import {
  expectRevisionPrompt,
  FEEDBACK,
  recordingExecutor,
  waitFor,
  workerDelegation,
  workerWork,
} from './delegation-revision.test-support'
import {
  archived,
  commandHostLayer,
  controlCommandAs,
  delegationCommand,
  seedQueenAuthority,
  useHiveHostTestContext,
  waitForSessionIdle,
} from './hive-worker-cleanup-host.test-harness'

const REQUEST_REVISION = {
  operation: 'delegation-request-revision',
  sessionId: 'queen',
  delegationId: 'delegation-worker',
  submissionRevision: 1,
  feedback: FEEDBACK,
} as const

/** An MCP server's transient caller: its grants live only on the connection, never in a row. */
function transientMcpCaller(
  capabilities: readonly SessionCapability[],
  scope: LocalSessionProfileScope = { all: true },
) {
  return {
    callerId: 'transient-mcp:digest',
    profileAuthority: {
      profileId: 'transient-mcp:digest',
      profileName: 'transient-mcp:digest',
      capabilities,
      scope,
      authorizationCeiling: 'yolo',
    },
  } satisfies LocalSessionCallerIdentity
}

function reviewAs(caller: LocalSessionCallerIdentity) {
  return executeSessionControlMutation({
    callerId: caller.callerId,
    caller,
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'mcp-review',
      idempotencyKey: 'mcp-review',
      command: REQUEST_REVISION,
    },
  })
}

describe('a revision request reaches its Worker or is refused', () => {
  const host = useHiveHostTestContext('openwaggle-delegation-revision-delivery-')

  it('refuses a live caller whose own grants do not let it message the Worker', async () => {
    const recorder = recordingExecutor()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'ready_for_review' })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
        const review = yield* reviewAs(transientMcpCaller(['delegations:review']))
        return {
          review: review.outcome,
          delegation: yield* workerDelegation(sql),
          work: yield* workerWork(sql),
        }
      }).pipe(
        Effect.provide(
          commandHostLayer(path.join(host.temporaryRoot, 'mcp-denied.sqlite'), recorder.executor),
        ),
      ),
    )

    expect(result.review).toMatchObject({ effect: 'rejected', code: 'worker_message_denied' })
    expect(result.delegation.state).toBe('ready_for_review')
    expect(result.work).toEqual({ activeRunId: null, queuedTexts: [] })
    expect(recorder.runs).toHaveLength(0)
  })

  it('refuses a live caller whose scope does not reach the Worker', async () => {
    const recorder = recordingExecutor()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'ready_for_review' })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
        const review = yield* reviewAs(
          transientMcpCaller(['delegations:review', 'sessions:message'], {
            projectPaths: [path.join(host.temporaryRoot, 'elsewhere')],
          }),
        )
        return { review: review.outcome, work: yield* workerWork(sql) }
      }).pipe(
        Effect.provide(
          commandHostLayer(path.join(host.temporaryRoot, 'mcp-scope.sqlite'), recorder.executor),
        ),
      ),
    )

    expect(result.review).toMatchObject({ effect: 'rejected', code: 'worker_message_denied' })
    expect(result.work).toEqual({ activeRunId: null, queuedTexts: [] })
    expect(recorder.runs).toHaveLength(0)
  })

  it('sends the revision request for a live caller that may message the Worker', async () => {
    const recorder = recordingExecutor()
    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'ready_for_review' })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
        const review = yield* reviewAs(
          transientMcpCaller(['delegations:review', 'sessions:message']),
        )
        expect(review.outcome).toMatchObject({ delegationState: 'revision_requested' })
        yield* waitFor(() => recorder.runs.length === 1)
        yield* waitForSessionIdle('worker')
      }).pipe(
        Effect.provide(
          commandHostLayer(path.join(host.temporaryRoot, 'mcp-allowed.sqlite'), recorder.executor),
        ),
      ),
    )

    expect(recorder.runs[0]?.sessionId).toBe('worker')
    expectRevisionPrompt(recorder.runs[0]?.intent.text, {
      submissionRevision: 1,
      feedback: FEEDBACK,
    })
  })

  /** A busy sibling Worker holds the only slot of the limit that `setting` sets to 1. */
  function reviewAtFullLimit(
    file: string,
    setting: 'sessionHostParentConcurrencyLimit' | 'sessionHostRunCeiling',
    callerId: string,
  ) {
    const recorder = recordingExecutor()
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'ready_for_review' })
        yield* seedHiveWorker(sql, { workerId: 'sibling', seedParent: false, state: 'working' })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
        yield* sql`
          INSERT INTO settings_store (key, value_json, updated_at)
          VALUES (${setting}, ${'1'}, ${1000})
        `
        yield* sql`UPDATE session_runs SET status = ${'active'} WHERE id = ${'run-sibling'}`
        yield* sql`
          UPDATE session_control_states SET active_run_id = ${'run-sibling'}
          WHERE session_id = ${'sibling'}
        `
        const review = yield* controlCommandAs(callerId, 'review-at-limit', REQUEST_REVISION)
        const workAfterReview = yield* workerWork(sql)
        if (review.outcome.effect !== 'rejected') {
          yield* waitFor(() => recorder.runs.length === 1)
          yield* waitForSessionIdle('worker')
        }
        return {
          review: review.outcome,
          workAfterReview,
          delegation: yield* workerDelegation(sql),
          runs: recorder.runs,
        }
      }).pipe(
        Effect.provide(commandHostLayer(path.join(host.temporaryRoot, file), recorder.executor)),
      ),
    )
  }

  it.each([
    ['Workers per parent', 'sessionHostParentConcurrencyLimit', 'parent_concurrency_limit_reached'],
    ['Active Workers', 'sessionHostRunCeiling', 'host_run_ceiling_reached'],
  ] as const)(
    "refuses an agent's revision request whose idle Worker would pass the %s limit",
    async (_label, setting, code) => {
      const result = await reviewAtFullLimit(`${setting}.sqlite`, setting, QUEEN_CALLER_ID)

      // Retryable, as a follow_up at the limit is, and nothing changed meanwhile.
      expect(result.review).toMatchObject({ effect: 'rejected', code })
      expect(result.delegation.state).toBe('ready_for_review')
      expect(result.workAfterReview).toEqual({ activeRunId: null, queuedTexts: [] })
      expect(result.runs).toHaveLength(0)
    },
  )

  it("never holds back the person's own revision request at a full limit", async () => {
    const result = await reviewAtFullLimit(
      'person.sqlite',
      'sessionHostParentConcurrencyLimit',
      'local-user',
    )

    expect(result.review).toMatchObject({ delegationState: 'revision_requested' })
    expect(result.workAfterReview.activeRunId).not.toBeNull()
    expect(result.runs[0]?.sessionId).toBe('worker')
  })

  it('restores a cleanup-archived Worker its parent reopens, then starts its Run', async () => {
    const recorder = recordingExecutor()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'ready_for_review' })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
        yield* delegationCommand(QUEEN_CALLER_ID, 'accept', {
          operation: 'delegation-accept',
          sessionId: 'queen',
          delegationId: 'delegation-worker',
        })
        if (!(yield* archived(sql, 'worker'))) throw new Error('Hive cleanup did not archive.')
        const reopened = yield* controlCommandAs(QUEEN_CALLER_ID, 'queen-reopen', {
          operation: 'delegation-reopen',
          sessionId: 'queen',
          delegationId: 'delegation-worker',
          reason: 'The error path is still missing.',
        })
        yield* waitFor(() => recorder.runs.length === 1)
        yield* waitForSessionIdle('worker')
        return { reopened: reopened.outcome, archived: yield* archived(sql, 'worker') }
      }).pipe(
        Effect.provide(
          commandHostLayer(path.join(host.temporaryRoot, 'archived.sqlite'), recorder.executor),
        ),
      ),
    )

    expect(result.reopened).toMatchObject({ delegationState: 'revision_requested' })
    expect(result.archived).toBe(false)
    expect(recorder.runs[0]?.sessionId).toBe('worker')
    expectRevisionPrompt(recorder.runs[0]?.intent.text, {
      submissionRevision: 1,
      feedback: 'The error path is still missing.',
    })
  })
})
