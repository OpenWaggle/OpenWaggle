import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionDelegationRepository } from '../../ports/session-delegation-repository'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import {
  type HiveParentWakeQuery,
  SessionOrchestrationUpdateRepository,
} from '../../ports/session-orchestration-update-repository'
import { SqliteSessionOrchestrationUpdateRepositoryLive } from '../sqlite-session-orchestration-update-repository'
import {
  makeSessionLifecycleTestLayer,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

const WORKER_AGENT = 'session-agent:session-worker:run-worker'

function delegationRequest(
  id: string,
  command:
    | {
        readonly operation: 'delegation-submit'
        readonly sessionId: string
        readonly delegationId: string
        readonly summary: string
        readonly evidence: readonly []
      }
    | {
        readonly operation: 'delegation-state'
        readonly sessionId: string
        readonly delegationId: string
        readonly state: 'working' | 'waiting' | 'needs_attention'
        readonly reason: string
      },
) {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: `request-${id}`,
    idempotencyKey: `idempotency-${id}`,
    command,
  } as const
}

const submit = (now: number, summary = 'Drafted the six epics.') =>
  Effect.gen(function* () {
    const delegations = yield* SessionDelegationRepository
    return yield* delegations.execute({
      callerId: WORKER_AGENT,
      request: delegationRequest(`submit-${now}`, {
        operation: 'delegation-submit',
        sessionId: 'session-worker',
        delegationId: 'delegation-worker',
        summary,
        evidence: [],
      }),
      now,
    })
  })

function pendingUpdates(sql: SqlClient.SqlClient) {
  return sql<{
    readonly parent_session_id: string
    readonly worker_session_id: string
    readonly source_run_id: string
    readonly state: string
    readonly summary: string
    readonly status: string
    readonly created_at: number
  }>`
    SELECT parent_session_id, worker_session_id, source_run_id, state, summary, status, created_at
    FROM session_orchestration_updates ORDER BY created_at
  `
}

/** The parent's Run ends, leaving it idle: the moment a Queen says "I'll report back". */
function settleParentRun(
  sql: SqlClient.SqlClient,
  input: { readonly status?: string; readonly callerId?: string } = {},
) {
  return Effect.gen(function* () {
    yield* sql`
      UPDATE session_runs
      SET status = ${input.status ?? 'completed'},
        intent_json = ${JSON.stringify({ callerId: input.callerId ?? 'local-user' })}
      WHERE id = ${'run-parent'}
    `
    yield* sql`
      UPDATE session_control_states SET active_run_id = NULL WHERE session_id = ${'session-parent'}
    `
  })
}

const candidate = (query: Partial<HiveParentWakeQuery> = {}) =>
  Effect.gen(function* () {
    const updates = yield* SessionOrchestrationUpdateRepository
    if (!updates.parentWakeCandidate) throw new Error('parentWakeCandidate is not implemented')
    return yield* updates.parentWakeCandidate({ parentSessionId: 'session-parent', ...query })
  })

describe('Hive wake: Worker updates reach an idle parent', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-hive-wake-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  type HiveWakeTestServices =
    | SqlClient.SqlClient
    | SessionDelegationRepository
    | SessionLifecycleRepository
    | SessionOrchestrationUpdateRepository

  function run<A, E>(effect: Effect.Effect<A, E, HiveWakeTestServices>) {
    const lifecycleLayer = makeSessionLifecycleTestLayer(path.join(root, 'hive-wake.db'))
    const layer = Layer.merge(
      lifecycleLayer,
      SqliteSessionOrchestrationUpdateRepositoryLive.pipe(Layer.provide(lifecycleLayer)),
    )
    return Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        yield* lifecycle.execute(spawnLifecycleInput())
        return yield* effect
      }).pipe(Effect.provide(layer)),
    )
  }

  it('records an update for the parent when a Worker submits its result itself', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* submit(3000)
        return yield* pendingUpdates(sql)
      }),
    )

    // Before the fix only a Worker Run's end recorded an update, and it skipped a Delegation the
    // Worker had already submitted, so its parent was never told.
    expect(result).toEqual([
      {
        parent_session_id: 'session-parent',
        worker_session_id: 'session-worker',
        source_run_id: 'run-worker',
        state: 'ready_for_review',
        summary: 'Drafted the six epics.',
        status: 'pending',
        created_at: 3000,
      },
    ])
  })

  it('records an update for the parent when a Worker asks it for help', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const delegations = yield* SessionDelegationRepository
        yield* delegations.execute({
          callerId: WORKER_AGENT,
          request: delegationRequest('help', {
            operation: 'delegation-state',
            sessionId: 'session-worker',
            delegationId: 'delegation-worker',
            state: 'needs_attention',
            reason: 'Which Jira project should the epics go to?',
          }),
          now: 3000,
        })
        yield* delegations.execute({
          callerId: WORKER_AGENT,
          request: delegationRequest('waiting', {
            operation: 'delegation-state',
            sessionId: 'session-worker',
            delegationId: 'delegation-worker',
            state: 'waiting',
            reason: 'Waiting for the answer.',
          }),
          now: 3100,
        })
        return yield* pendingUpdates(sql)
      }),
    )

    expect(result).toMatchObject([
      {
        state: 'needs_attention',
        summary: 'Which Jira project should the epics go to?',
        status: 'pending',
      },
    ])
  })

  it('wakes an idle parent for an update that arrived after its latest Run started', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* settleParentRun(sql, { callerId: 'local-user' })
        const beforeAnyUpdate = yield* candidate()
        yield* submit(3000)
        return { beforeAnyUpdate, afterSubmit: yield* candidate() }
      }),
    )

    expect(result).toEqual({
      beforeAnyUpdate: undefined,
      afterSubmit: {
        parentSessionId: 'session-parent',
        callerId: 'local-user',
        piSessionFile: null,
      },
    })
  })

  it('does not wake a parent that is running, archived, or was stopped', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* submit(3000)
        const running = yield* candidate()
        yield* settleParentRun(sql, { status: 'interrupted' })
        const stopped = yield* candidate()
        yield* sql`UPDATE session_runs SET status = ${'completed'} WHERE id = ${'run-parent'}`
        yield* sql`UPDATE sessions SET archived = ${1} WHERE id = ${'session-parent'}`
        const archived = yield* candidate()
        return { running, stopped, archived }
      }),
    )

    expect(result).toEqual({ running: undefined, stopped: undefined, archived: undefined })
  })

  it('wakes a parent once per update: a Run that started after it ends the claim', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* settleParentRun(sql)
        yield* submit(3000)
        // A wake Run (or any Run) started after the update and failed before it loaded it.
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
          VALUES (
            ${'run-wake'}, ${'session-parent'}, ${'failed'},
            ${JSON.stringify({ callerId: 'local-user' })}, ${3500}, ${3600}
          )
        `
        return yield* candidate()
      }),
    )

    expect(result).toBeUndefined()
  })

  it('wakes a parent whose Run received an update only after its last turn ended', async () => {
    const result = await run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* submit(3000)
        const updates = yield* SessionOrchestrationUpdateRepository
        const [pending] = yield* updates.listPending({ parentSessionId: 'session-parent' })
        if (!pending) throw new Error('missing update')
        // The live sink appended it to the parent's Run, which had already answered.
        yield* updates.markDelivered({
          updateIds: [pending.updateId],
          parentSessionId: 'session-parent',
          runId: 'run-parent',
          itemIds: ['item-late'],
          deliveredAt: 3050,
        })
        yield* settleParentRun(sql)
        return {
          answeredBefore: yield* candidate({
            settledRun: { runId: 'run-parent', terminalEventAt: 2900 },
          }),
          answeredAfter: yield* candidate({
            settledRun: { runId: 'run-parent', terminalEventAt: 3200 },
          }),
          withoutSettlement: yield* candidate(),
        }
      }),
    )

    expect(result).toEqual({
      answeredBefore: {
        parentSessionId: 'session-parent',
        callerId: 'local-user',
        piSessionFile: null,
      },
      answeredAfter: undefined,
      withoutSettlement: undefined,
    })
  })
})
