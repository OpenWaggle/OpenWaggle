/** One Host over a shared database file, for the next-actor integration tests (#380). */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { hiveNextActor } from '@shared/domain/hive-next-actor'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import { submitSessionMessage } from '../../application/session-control-service'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { loadHiveNextActorFacts } from '../sqlite-hive-next-actor-facts'
import { updateDelegationState } from '../sqlite-session-delegation-state'
import {
  makeSessionControlRunLifecycleTestLayer,
  prepareWorkerDelegation,
} from './sqlite-session-control-run-lifecycle-test-layer'

export const WORKER = SessionId('worker')
const DATABASE = 'hive-next-actor.sqlite'
let temporaryRoot = ''
let runCounter = 0
let hostStarts = 0

/** A fresh database for one test: a Queen and its Worker, plus an unrelated Session agent. */
export async function openHiveNextActorHost() {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-hive-next-actor-'))
  runCounter = 0
  hostStarts = 0
  await withHost((sql) =>
    Effect.gen(function* () {
      yield* prepareWorkerDelegation(sql)
      yield* sql`
        INSERT INTO session_control_states (
          session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
        ) VALUES (${'queen'}, ${0}, ${null}, ${'running'}, ${0}, ${1000})
      `
      // Two Session agents that may message the Worker: its parent, and an unrelated Session.
      yield* sql`INSERT INTO sessions (id) VALUES (${'stranger'})`
      for (const sessionId of ['queen', 'stranger']) {
        yield* sql`
          INSERT INTO session_execution_profiles (
            session_id, profile_json, authority_origin_caller_id,
            authorization_ceiling, created_at, updated_at
          ) VALUES (
            ${sessionId}, ${'{"modelId":"provider/model","thinkingLevel":"medium"}'},
            ${'local-user'}, ${'ask-for-approval'}, ${1000}, ${1000}
          )
        `
      }
    }),
  )
}

export async function closeHiveNextActorHost() {
  await fs.rm(temporaryRoot, { recursive: true, force: true })
}

type HostServices = Layer.Layer.Success<ReturnType<typeof makeSessionControlRunLifecycleTestLayer>>

/** One Host process over the shared database file; a second call is a Host restart. */
export function withHost<A>(
  run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, HostServices>,
) {
  hostStarts += 1
  const layer = makeSessionControlRunLifecycleTestLayer(
    path.join(temporaryRoot, DATABASE),
    {
      nextRunId: Effect.sync(() => {
        runCounter += 1
        return RunId(`run-${String(runCounter)}`)
      }),
    },
    { reopen: hostStarts > 1 },
  )
  return Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* run(sql)
    }).pipe(Effect.provide(layer)),
  )
}

export function message(callerId: string, idempotencyKey: string) {
  return submitSessionMessage({
    callerId,
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: `request-${idempotencyKey}`,
      idempotencyKey,
      command: {
        operation: 'message',
        sessionId: 'worker',
        input: { text: 'Carry on.', attachmentIds: [] },
      },
    },
  })
}

/** A message that starts a Worker Run, then its activation and settlement. */
export function runWorker(callerId: string, key: string, terminalStatus: 'completed' | 'failed') {
  return Effect.gen(function* () {
    const started = yield* message(callerId, key)
    if (started.outcome.effect !== 'started-run')
      throw new Error(`no Run: ${started.outcome.effect}`)
    const runId = RunId(started.outcome.runId)
    const lifecycle = yield* SessionControlRunLifecycleRepository
    const activation = yield* lifecycle.activate({ sessionId: WORKER, runId })
    const settlement = yield* lifecycle.settle({
      sessionId: WORKER,
      runId,
      nextRunId: RunId(`after-${key}`),
      terminalStatus,
      ...(terminalStatus === 'completed' ? { finalResponse: 'Done.' } : {}),
    })
    return { activation, settlement }
  })
}

/** A message that starts a Worker Run, activated and left running. */
export function startWorker(callerId: string, key: string) {
  return Effect.gen(function* () {
    const started = yield* message(callerId, key)
    if (started.outcome.effect !== 'started-run')
      throw new Error(`no Run: ${started.outcome.effect}`)
    const lifecycle = yield* SessionControlRunLifecycleRepository
    return yield* lifecycle.activate({ sessionId: WORKER, runId: RunId(started.outcome.runId) })
  })
}

export function setWorkerState(sql: SqlClient.SqlClient, state: 'working' | 'needs_attention') {
  return Effect.gen(function* () {
    const [contract] = yield* sql<{
      readonly state: 'working' | 'needs_attention'
      readonly latest: number
    }>`SELECT state, 0 AS latest FROM delegation_contracts WHERE id = ${'delegation-worker'}`
    if (!contract) throw new Error('missing Delegation')
    return yield* updateDelegationState(
      sql,
      {
        callerId: 'session-agent:worker:run-w',
        now: Date.now(),
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: `state-${state}`,
          idempotencyKey: `state-${state}-${String(Date.now())}`,
          command: {
            operation: 'delegation-state',
            sessionId: 'worker',
            delegationId: 'delegation-worker',
            state,
            reason: 'I need the staging credentials.',
          },
        },
      },
      {
        id: 'delegation-worker',
        parent_session_id: 'queen',
        child_session_id: 'worker',
        state: contract.state,
        current_specification_revision: 1,
        latest_submission_revision: 0,
      },
    )
  })
}

export function readDelegation(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const [contract] = yield* sql<{ readonly state: string; readonly cause: string | null }>`
      SELECT state, attention_cause AS cause FROM delegation_contracts
      WHERE id = ${'delegation-worker'}
    `
    const transitions = yield* sql<{
      readonly from_state: string
      readonly to_state: string
      readonly authored_by: string
    }>`
      SELECT from_state, to_state, authored_by FROM delegation_state_transitions
      WHERE delegation_id = ${'delegation-worker'} ORDER BY id
    `
    const facts = (yield* loadHiveNextActorFacts(sql, ['worker'])).get('worker')
    return {
      state: contract?.state,
      cause: contract?.cause,
      transitions: transitions.map((row) => `${row.from_state}>${row.to_state}:${row.authored_by}`),
      next: facts ? hiveNextActor(facts) : null,
    }
  })
}

export function setParentQueue(
  sql: SqlClient.SqlClient,
  input: {
    readonly activeRun: boolean
    readonly queue: 'running' | 'paused'
    readonly items: number
  },
) {
  return Effect.gen(function* () {
    yield* sql`DELETE FROM session_follow_ups WHERE session_id = ${'queen'}`
    if (input.activeRun) {
      yield* sql`
        INSERT OR IGNORE INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
        VALUES (${'queen-run'}, ${'queen'}, ${'active'}, ${'{}'}, 1, 1)
      `
    }
    yield* sql`
      UPDATE session_control_states
      SET active_run_id = ${input.activeRun ? 'queen-run' : null}, queue_state = ${input.queue}
      WHERE session_id = ${'queen'}
    `
    for (let position = 0; position < input.items; position += 1) {
      yield* sql`
        INSERT INTO session_follow_ups (
          id, session_id, position, delivery_state, intent_json, created_at, updated_at
        ) VALUES (
          ${`queen-follow-up-${String(position)}`}, ${'queen'}, ${position}, ${'pending'},
          ${'{}'}, 1, 1
        )
      `
    }
  })
}
