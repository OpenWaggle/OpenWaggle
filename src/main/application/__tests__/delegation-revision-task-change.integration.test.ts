import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { DelegationState } from '@shared/types/session-collaboration'
import type { SessionControlMutationRequest } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  QUEEN_CALLER_ID,
  seedHiveWorker,
} from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import {
  expectRevisionPrompt,
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

const REASON = 'The task now covers the error path.'

const SPECIFICATION = { ...REVISED_SPECIFICATION, dependencies: [] } as const

const AMEND = {
  operation: 'delegation-amend',
  sessionId: 'queen',
  delegationId: 'delegation-worker',
  expectedSpecificationRevision: 1,
  specification: SPECIFICATION,
  reason: REASON,
} as const satisfies SessionControlMutationRequest['command']

const ADD_DEPENDENCY = {
  operation: 'delegation-dependency',
  sessionId: 'queen',
  delegationId: 'delegation-worker',
  action: 'add',
  dependencyDelegationId: 'delegation-sibling',
  requiredState: 'accepted',
  reason: REASON,
} as const satisfies SessionControlMutationRequest['command']

/** A Worker with one submission, a sibling to depend on, and a valid current specification. */
function seedSubmittedWorker(
  sql: SqlClient.SqlClient,
  projectPath: string,
  state: DelegationState,
) {
  return Effect.gen(function* () {
    yield* seedHiveWorker(sql, { state })
    yield* seedHiveWorker(sql, { workerId: 'sibling', seedParent: false })
    yield* seedQueenAuthority(sql, projectPath)
    yield* sql`
      UPDATE delegation_specifications SET specification_json = ${JSON.stringify({
        objective: 'Review the tests',
        deliverables: [],
        acceptanceCriteria: [],
        resourceReferences: [],
        dependencies: [],
      })}
    `
  })
}

describe('a task change sends a Worker whose result awaits review back to work', () => {
  const host = useHiveHostTestContext('openwaggle-delegation-task-change-')

  it.each([
    ['an amendment', AMEND],
    ['a dependency change', ADD_DEPENDENCY],
  ] as const)('starts a Run on an idle Worker for %s', async (_label, command) => {
    const recorder = recordingExecutor()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedSubmittedWorker(sql, host.temporaryRoot, 'ready_for_review')
        const change = yield* controlCommandAs(QUEEN_CALLER_ID, 'queen-change', command)
        const workAfterChange = yield* workerWork(sql)
        yield* waitFor(() => recorder.runs.length === 1)
        yield* waitForSessionIdle('worker')
        return { change: change.outcome, workAfterChange, delegation: yield* workerDelegation(sql) }
      }).pipe(
        Effect.provide(
          commandHostLayer(path.join(host.temporaryRoot, 'change.sqlite'), recorder.executor),
        ),
      ),
    )

    expect(result.change).toMatchObject({
      delegationState: 'revision_requested',
      specificationRevision: 2,
      revisionRequest: { parentSessionId: 'queen', submissionRevision: 1 },
    })
    expect(result.workAfterChange.activeRunId).not.toBeNull()
    expect(recorder.runs[0]?.sessionId).toBe('worker')
    expectRevisionPrompt(recorder.runs[0]?.intent.text, { submissionRevision: 1, feedback: REASON })
    expect(recorder.runs[0]?.intent.text).toContain('"specificationRevision":2')
    expect(result.delegation.state).toBe('ready_for_review')
    expect(result.delegation.submissions.map((row) => row.revision)).toEqual([1, 2])
  })

  it('sends nothing to a Worker that is still on the task', async () => {
    const recorder = recordingExecutor()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedSubmittedWorker(sql, host.temporaryRoot, 'working')
        const change = yield* controlCommandAs(QUEEN_CALLER_ID, 'queen-change', AMEND)
        return { change: change.outcome, work: yield* workerWork(sql) }
      }).pipe(
        Effect.provide(
          commandHostLayer(path.join(host.temporaryRoot, 'working.sqlite'), recorder.executor),
        ),
      ),
    )

    // The new specification reaches it in its current or next Run, as before.
    expect(result.change).toMatchObject({ effect: 'delegation-specification-amended' })
    expect(result.change).not.toHaveProperty('revisionRequest')
    expect(result.work).toEqual({ activeRunId: null, queuedTexts: [] })
    expect(recorder.runs).toHaveLength(0)
  })

  it('refuses a task change that would send the Worker back to work from a reviewer that may not message it', async () => {
    const recorder = recordingExecutor()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedSubmittedWorker(sql, host.temporaryRoot, 'ready_for_review')
        yield* sql`
          UPDATE session_execution_profiles
          SET profile_json = ${JSON.stringify({
            modelId: 'provider/model',
            thinkingLevel: 'medium',
            sessionCapabilities: ['delegations:review'],
          })}
          WHERE session_id = ${'queen'}
        `
        const change = yield* controlCommandAs(QUEEN_CALLER_ID, 'queen-change', AMEND)
        return { change: change.outcome, delegation: yield* workerDelegation(sql) }
      }).pipe(
        Effect.provide(
          commandHostLayer(path.join(host.temporaryRoot, 'denied.sqlite'), recorder.executor),
        ),
      ),
    )

    expect(result.change).toMatchObject({ effect: 'rejected', code: 'worker_message_denied' })
    expect(result.delegation.state).toBe('ready_for_review')
    expect(recorder.runs).toHaveLength(0)
  })
})
