import path from 'node:path'
import type * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
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

export const WORKER_AGENT = 'session-agent:session-worker:run-worker'

export function delegationRequest(
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

export const submit = (now: number, summary = 'Drafted the six epics.', callerId = WORKER_AGENT) =>
  Effect.gen(function* () {
    const delegations = yield* SessionDelegationRepository
    return yield* delegations.execute({
      callerId,
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

export function pendingUpdates(sql: SqlClient.SqlClient) {
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
export function settleParentRun(
  sql: SqlClient.SqlClient,
  input: {
    readonly status?: string
    readonly callerId?: string
    readonly runAuthorizationOverride?: string
  } = {},
) {
  return Effect.gen(function* () {
    const intent = {
      callerId: input.callerId ?? 'local-user',
      ...(input.runAuthorizationOverride
        ? { runAuthorizationOverride: input.runAuthorizationOverride }
        : {}),
    }
    yield* sql`
      UPDATE session_runs
      SET status = ${input.status ?? 'completed'}, intent_json = ${JSON.stringify(intent)}
      WHERE id = ${'run-parent'}
    `
    yield* sql`
      UPDATE session_control_states SET active_run_id = NULL WHERE session_id = ${'session-parent'}
    `
  })
}

export const candidate = (query: Partial<HiveParentWakeQuery> = {}) =>
  Effect.gen(function* () {
    const updates = yield* SessionOrchestrationUpdateRepository
    if (!updates.parentWakeCandidate) throw new Error('parentWakeCandidate is not implemented')
    return yield* updates.parentWakeCandidate({ parentSessionId: 'session-parent', ...query })
  })

export type HiveWakeTestServices =
  | SqlClient.SqlClient
  | SessionDelegationRepository
  | SessionLifecycleRepository
  | SessionOrchestrationUpdateRepository

/** Runs `effect` against a fresh database under `root`, with a parent and its spawned Worker. */
export function runHiveWakeTest<A, E>(
  root: string,
  effect: Effect.Effect<A, E, HiveWakeTestServices>,
) {
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

export function markRead(updateId: string, runId: string) {
  return Effect.gen(function* () {
    const updates = yield* SessionOrchestrationUpdateRepository
    yield* updates.markDelivered({
      updateIds: [updateId],
      parentSessionId: 'session-parent',
      runId,
      itemIds: ['item-read'],
      deliveredAt: 3050,
    })
  })
}

export function insertParentRun(
  sql: SqlClient.SqlClient,
  input: { readonly id: string; readonly status: string; readonly hiveWake?: true },
) {
  const intent = { callerId: 'local-user', ...(input.hiveWake ? { hiveWake: true } : {}) }
  return sql`
    INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
    VALUES (
      ${input.id}, ${'session-parent'}, ${input.status}, ${JSON.stringify(intent)},
      ${4000}, ${4100}
    )
  `
}
