import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { hiveNextActor } from '@shared/domain/hive-next-actor'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { submitSessionMessage } from '../../application/session-control-service'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { clearWorkerRequestOnParentDelivery } from '../sqlite-delegation-attention'
import { loadHiveNextActorFacts } from '../sqlite-hive-next-actor-facts'
import { updateDelegationState } from '../sqlite-session-delegation-state'
import {
  makeSessionControlRunLifecycleTestLayer,
  prepareWorkerDelegation,
} from './sqlite-session-control-run-lifecycle-test-layer'

const WORKER = SessionId('worker')
const DATABASE = 'hive-next-actor.sqlite'
let temporaryRoot = ''
let runCounter = 0
let hostStarts = 0

type HostServices = Layer.Layer.Success<ReturnType<typeof makeSessionControlRunLifecycleTestLayer>>

/** One Host process over the shared database file; a second call is a Host restart. */
function withHost<A>(run: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown, HostServices>) {
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

function message(callerId: string, idempotencyKey: string) {
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
function runWorker(callerId: string, key: string, terminalStatus: 'completed' | 'failed') {
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
function startWorker(callerId: string, key: string) {
  return Effect.gen(function* () {
    const started = yield* message(callerId, key)
    if (started.outcome.effect !== 'started-run')
      throw new Error(`no Run: ${started.outcome.effect}`)
    const lifecycle = yield* SessionControlRunLifecycleRepository
    return yield* lifecycle.activate({ sessionId: WORKER, runId: RunId(started.outcome.runId) })
  })
}

function setWorkerState(sql: SqlClient.SqlClient, state: 'working' | 'needs_attention') {
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

function readDelegation(sql: SqlClient.SqlClient) {
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

function setParentQueue(
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

describe('Hive next actor across Host transitions (#380)', () => {
  beforeEach(async () => {
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
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('records a failed Run in the history and routes it by the parent’s activity, after a restart too', async () => {
    await withHost(() => runWorker('local-user', 'fails', 'failed'))
    const afterFailure = await withHost(readDelegation)
    expect(afterFailure).toEqual({
      state: 'needs_attention',
      cause: 'run_failed',
      transitions: ['working>needs_attention:session-host'],
      // The Queen is idle with nothing queued: no agent will pick the Worker up.
      next: { nextActor: 'user', reason: 'stuck' },
    })

    const withActiveQueen = await withHost((sql) =>
      setParentQueue(sql, { activeRun: true, queue: 'running', items: 0 }).pipe(
        Effect.zipRight(readDelegation(sql)),
      ),
    )
    expect(withActiveQueen.next).toEqual({ nextActor: 'parent', reason: 'run-failed' })
  })

  it('derives "no agent will pick it up" live from the parent’s Run and queue', async () => {
    await withHost(() => runWorker('local-user', 'fails', 'failed'))
    const nextFor = (input: Parameters<typeof setParentQueue>[1]) =>
      withHost((sql) =>
        setParentQueue(sql, input).pipe(
          Effect.zipRight(readDelegation(sql)),
          Effect.map((read) => read.next?.nextActor),
        ),
      )
    expect(await nextFor({ activeRun: false, queue: 'running', items: 0 })).toBe('user')
    expect(await nextFor({ activeRun: false, queue: 'running', items: 1 })).toBe('parent')
    // A paused queue waits on the person.
    expect(await nextFor({ activeRun: false, queue: 'paused', items: 1 })).toBe('user')
    expect(await nextFor({ activeRun: true, queue: 'paused', items: 0 })).toBe('parent')
  })

  it('clears a failed Run when a new Run starts from any source, and keeps it cleared after a restart', async () => {
    await withHost(() => runWorker('local-user', 'fails', 'failed'))
    // The person types in the Worker: not the parent, still a new Run.
    const activation = await withHost(() => startWorker('local-user', 'retry'))
    expect(activation).toMatchObject({
      accepted: true,
      attentionCleared: {
        delegationId: 'delegation-worker',
        parentSessionId: SessionId('queen'),
        workerSessionId: WORKER,
        state: 'working',
      },
    })
    expect(await withHost(readDelegation)).toEqual({
      state: 'working',
      cause: null,
      transitions: ['working>needs_attention:session-host', 'needs_attention>working:session-host'],
      next: { nextActor: 'worker', reason: 'working' },
    })
  })

  it('returns a Worker that failed while revising to revising', async () => {
    await withHost(
      (sql) =>
        sql`UPDATE delegation_contracts SET state = ${'revision_requested'} WHERE id = ${'delegation-worker'}`,
    )
    await withHost(() => runWorker('local-user', 'fails', 'failed'))
    await withHost(() => startWorker('local-user', 'retry'))
    const read = await withHost(readDelegation)
    expect(read).toMatchObject({ state: 'revision_requested', cause: null })
    expect(read.next).toEqual({ nextActor: 'worker', reason: 'revising' })
  })

  it('keeps a Worker’s request for help through Runs nobody from the parent started', async () => {
    await withHost((sql) => setWorkerState(sql, 'needs_attention'))
    expect(await withHost(readDelegation)).toMatchObject({
      state: 'needs_attention',
      cause: 'worker_request',
      next: { nextActor: 'user', reason: 'stuck' },
    })
    const activation = await withHost(() => startWorker('local-user', 'person'))
    expect(activation).not.toHaveProperty('attentionCleared')
    // Another Session's agent is not the parent.
    await withHost(
      (sql) =>
        sql`UPDATE session_control_states SET active_run_id = NULL WHERE session_id = ${'worker'}`,
    )
    const stranger = await withHost(() => message('session-agent:stranger:run-s', 'stranger'))
    expect(stranger.outcome.effect).toBe('started-run')
    const read = await withHost((sql) =>
      setParentQueue(sql, { activeRun: true, queue: 'running', items: 0 }).pipe(
        Effect.zipRight(readDelegation(sql)),
      ),
    )
    expect(read).toMatchObject({ state: 'needs_attention', cause: 'worker_request' })
    expect(read.next).toEqual({ nextActor: 'parent', reason: 'asked-for-help' })
  })

  it('clears a Worker’s request for help when the parent delivers to it, after a restart too', async () => {
    await withHost((sql) => setWorkerState(sql, 'needs_attention'))
    const answer = await withHost(() => message('session-agent:queen:run-q', 'answer'))
    expect(answer.outcome.effect).toBe('started-run')
    expect(await withHost(readDelegation)).toMatchObject({
      state: 'working',
      cause: null,
      transitions: [
        'working>needs_attention:session-agent:worker:run-w',
        'needs_attention>working:session-agent:queen:run-q',
      ],
    })
  })

  it('clears a Worker’s request for help when it sets itself back to working', async () => {
    await withHost((sql) => setWorkerState(sql, 'needs_attention'))
    await withHost((sql) => setWorkerState(sql, 'working'))
    expect(await withHost(readDelegation)).toMatchObject({
      state: 'working',
      cause: null,
      next: { nextActor: 'worker', reason: 'working' },
    })
  })

  it('treats steering, a promotion and a replacement from the parent as delivery, and nothing else', async () => {
    const cleared = await withHost((sql) =>
      Effect.gen(function* () {
        const results: Record<string, boolean> = {}
        const attempts = [
          ['interrupt', 'session-agent:queen:run-q'],
          ['queue-pause', 'session-agent:queen:run-q'],
          ['steer', 'local-user'],
          ['steer', 'session-agent:stranger:run-s'],
          ['steer', 'session-agent:queen:run-q'],
          ['promote', 'session-agent:queen:run-q'],
          ['replace', 'session-agent:queen:run-q'],
        ] as const
        for (const [operation, callerId] of attempts) {
          yield* setWorkerState(sql, 'needs_attention')
          const result = yield* clearWorkerRequestOnParentDelivery(sql, {
            workerSessionId: 'worker',
            callerId,
            operation,
            now: Date.now(),
          })
          results[`${operation} by ${callerId}`] = result !== undefined
        }
        return results
      }),
    )
    expect(cleared).toEqual({
      'interrupt by session-agent:queen:run-q': false,
      'queue-pause by session-agent:queen:run-q': false,
      'steer by local-user': false,
      'steer by session-agent:stranger:run-s': false,
      'steer by session-agent:queen:run-q': true,
      'promote by session-agent:queen:run-q': true,
      'replace by session-agent:queen:run-q': true,
    })
  })
})
