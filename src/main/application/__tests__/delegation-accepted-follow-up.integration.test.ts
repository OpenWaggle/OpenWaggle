import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionControlMutationRequest } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  QUEEN_CALLER_ID,
  seedHiveWorker,
} from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import { selectHiveParentWakeCandidate } from '../../adapters/sqlite-hive-parent-wake-candidate'
import type { SessionControlRunExecutorShape } from '../../ports/session-control-run-executor'
import { installHiveParentWakeHandler } from '../hive-parent-wake-request'
import { recordingExecutor, waitFor, workerDelegation } from './delegation-revision.test-support'
import {
  commandHostLayer,
  controlCommandAs,
  seedQueenAuthority,
  useHiveHostTestContext,
  waitForSessionIdle,
} from './hive-worker-cleanup-host.test-harness'

const MORE_WORK = 'Now check the error path too.'

type HostContext = Layer.Layer.Success<ReturnType<typeof commandHostLayer>>

function followUpAs(callerId: string, key: string) {
  const command: SessionControlMutationRequest['command'] = {
    operation: 'follow-up',
    sessionId: 'worker',
    input: { text: MORE_WORK, attachmentIds: [] },
  }
  return controlCommandAs(callerId, key, command)
}

function pendingUpdates(sql: SqlClient.SqlClient) {
  return sql<{ readonly state: string; readonly source_run_id: string; readonly summary: string }>`
    SELECT state, source_run_id, summary FROM session_orchestration_updates
    WHERE parent_session_id = ${'queen'} AND status = ${'pending'}
  `
}

function transitions(sql: SqlClient.SqlClient) {
  return sql<{
    readonly from_state: string
    readonly to_state: string
    readonly authored_by: string
  }>`
    SELECT from_state, to_state, authored_by FROM delegation_state_transitions
    WHERE delegation_id = ${'delegation-worker'} ORDER BY id
  `
}

/**
 * The Queen accepts a Worker's result, then gives it more work. The Worker's answer must reach
 * the idle Queen and wake it, as its first result did (TC-mapping Hive, beta.38): the accepted
 * Delegation recorded no update when that Run ended, and a report never starts a Run.
 */
describe('new work the parent sends to a Worker it accepted', () => {
  const host = useHiveHostTestContext('openwaggle-delegation-accepted-follow-up-')
  const wakeRequests: string[] = []
  let releaseWakeHandler: (() => void) | undefined
  beforeEach(() => {
    wakeRequests.length = 0
    releaseWakeHandler = installHiveParentWakeHandler((request) => {
      wakeRequests.push(request.parentSessionId)
    })
  })
  afterEach(() => releaseWakeHandler?.())

  function run<A, E>(
    name: string,
    executor: SessionControlRunExecutorShape,
    body: (sql: SqlClient.SqlClient) => Effect.Effect<A, E, HostContext>,
    state: 'accepted' | 'cancelled' = 'accepted',
  ) {
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
        // The wake candidate reads the column the Session Control test schema leaves out.
        yield* sql.unsafe('ALTER TABLE sessions ADD COLUMN pi_session_file TEXT')
        // The person started the Queen's last Run, so a wake may act for them.
        yield* sql`
          UPDATE session_runs SET intent_json = ${JSON.stringify({ callerId: 'gui:local-user' })}
          WHERE id = ${'run-queen'}
        `
        return yield* body(sql)
      }).pipe(Effect.provide(commandHostLayer(path.join(host.temporaryRoot, name), executor))),
    )
  }

  it('reopens the Delegation, takes the reply as a result and wakes the idle parent', async () => {
    const recorder = recordingExecutor()
    const result = await run('follow-up.sqlite', recorder.executor, (sql) =>
      Effect.gen(function* () {
        const sent = yield* followUpAs(QUEEN_CALLER_ID, 'queen-follow-up')
        yield* waitFor(() => recorder.runs.length === 1)
        yield* waitForSessionIdle('worker')
        return {
          sent: sent.outcome.effect,
          delegation: yield* workerDelegation(sql),
          transitions: yield* transitions(sql),
          updates: yield* pendingUpdates(sql),
          candidate: yield* selectHiveParentWakeCandidate(sql, { parentSessionId: 'queen' }),
        }
      }),
    )

    expect(result.sent).toBe('started-run')
    expect(recorder.runs[0]?.intent.text).toBe(MORE_WORK)
    const workerRunId = recorder.runs[0]?.runId
    expect(result.transitions).toContainEqual({
      from_state: 'accepted',
      to_state: 'working',
      authored_by: QUEEN_CALLER_ID,
    })
    expect(result.delegation.state).toBe('ready_for_review')
    expect(result.delegation.submissions.map((row) => row.revision)).toEqual([1, 2])
    expect(result.delegation.submissions[1]?.source_run_id).toBe(workerRunId)
    expect(result.updates).toEqual([
      { state: 'ready_for_review', source_run_id: workerRunId, summary: 'Reply 1.' },
    ])
    expect(wakeRequests).toContain('queen')
    expect(result.candidate).toMatchObject({ parentSessionId: 'queen', callerId: 'gui:local-user' })
  })

  it('tells the parent when the Run it sent fails', async () => {
    const executor: SessionControlRunExecutorShape = {
      execute: () => Effect.succeed({ terminalStatus: 'failed' as const }),
    }
    const result = await run('failed.sqlite', executor, (sql) =>
      Effect.gen(function* () {
        yield* followUpAs(QUEEN_CALLER_ID, 'queen-follow-up')
        yield* waitFor(() => wakeRequests.includes('queen'))
        yield* waitForSessionIdle('worker')
        return { delegation: yield* workerDelegation(sql), updates: yield* pendingUpdates(sql) }
      }),
    )

    expect(result.delegation.state).toBe('needs_attention')
    expect(result.updates.map((update) => update.state)).toEqual(['needs_attention'])
  })

  it('leaves the Delegation closed for a Run someone else starts', async () => {
    const recorder = recordingExecutor()
    const result = await run('person.sqlite', recorder.executor, (sql) =>
      Effect.gen(function* () {
        yield* followUpAs('gui:local-user', 'person-follow-up')
        yield* waitFor(() => recorder.runs.length === 1)
        yield* waitForSessionIdle('worker')
        return { delegation: yield* workerDelegation(sql), updates: yield* pendingUpdates(sql) }
      }),
    )

    expect(result.delegation.state).toBe('accepted')
    expect(result.delegation.submissions).toHaveLength(1)
    expect(result.updates).toEqual([])
  })

  it('leaves a cancelled Delegation cancelled', async () => {
    const recorder = recordingExecutor()
    const result = await run(
      'cancelled.sqlite',
      recorder.executor,
      (sql) =>
        Effect.gen(function* () {
          yield* followUpAs(QUEEN_CALLER_ID, 'queen-follow-up')
          yield* waitFor(() => recorder.runs.length === 1)
          yield* waitForSessionIdle('worker')
          return { delegation: yield* workerDelegation(sql), updates: yield* pendingUpdates(sql) }
        }),
      'cancelled',
    )

    expect(result.delegation.state).toBe('cancelled')
    expect(result.updates).toEqual([])
  })
})
