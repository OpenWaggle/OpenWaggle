import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionControlOperationJournal } from '../../ports/session-control-operation-journal'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { loadSessionControlState } from '../sqlite-session-control-state'
import { countActiveWorkerRuns } from '../sqlite-worker-run-admission'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'
import {
  AGENT_CALLER,
  seedHive,
  storeHostRunCeiling,
} from './sqlite-worker-run-admission.test-support'

let temporaryRoot = ''

/**
 * `session-target`, a root the person made, running the person's Run while two Workers fill an
 * Active Workers ceiling of 2, with a Follow-up from each of `callerIds` queued behind it.
 */
function personRunAtFullCeiling(
  callerIds: readonly string[],
  queue: { readonly pausedForCapacity?: boolean; readonly runCallerId?: string } = {},
) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* seedHive(sql, 2)
    yield* storeHostRunCeiling(sql, 2)
    // Delivery re-checks a Follow-up's authority against the target's execution profile.
    yield* sql`
      INSERT INTO session_execution_profiles (
        session_id, profile_json, authority_origin_caller_id,
        authorization_ceiling, created_at, updated_at
      ) VALUES (
        ${'session-target'}, ${'{"modelId":"provider/model","thinkingLevel":"medium"}'},
        ${'gui:local-user'}, ${'ask-for-approval'}, ${1}, ${1}
      )
    `
    const personIntent = {
      text: 'Mine.',
      attachmentIds: [],
      callerId: queue.runCallerId ?? 'gui:local-user',
      acceptedAt: 1,
      idempotencyKey: 'key-mine',
    }
    yield* sql`
      INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
      VALUES (
        ${'run-target'}, ${'session-target'}, ${'active'}, ${JSON.stringify(personIntent)}, ${1}, ${1}
      )
    `
    yield* sql`
      UPDATE session_control_states
      SET active_run_id = ${'run-target'}, state_revision = ${1},
        queue_state = ${queue.pausedForCapacity ? 'paused' : 'running'},
        queue_pause_reason = ${queue.pausedForCapacity ? 'parent-limit' : null}
      WHERE session_id = ${'session-target'}
    `
    for (const [position, callerId] of callerIds.entries()) {
      const intent = {
        text: `Queued ${position}.`,
        attachmentIds: [],
        callerId,
        acceptedAt: position + 2,
        idempotencyKey: `key-${position}`,
      }
      yield* sql`
        INSERT INTO session_follow_ups (
          id, session_id, position, delivery_state, intent_json, created_at, updated_at
        ) VALUES (
          ${`queued-${position}`}, ${'session-target'}, ${position}, ${'pending'},
          ${JSON.stringify(intent)}, ${1}, ${1}
        )
      `
    }
    return sql
  })
}

function settleTarget(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const lifecycle = yield* SessionControlRunLifecycleRepository
    const settled = yield* lifecycle.settle({
      sessionId: SessionId('session-target'),
      runId: RunId('run-target'),
      nextRunId: RunId('run-after'),
      terminalStatus: 'completed',
      terminalEventAt: 2,
    })
    return {
      settled,
      after: yield* loadSessionControlState(sql, 'session-target'),
      activeWorkerRuns: yield* countActiveWorkerRuns(sql),
    }
  })
}

function replaceTarget(
  callerId: string,
  sessionId = 'session-target',
  runId = 'run-target',
  hostRunCeiling = 2,
) {
  return Effect.gen(function* () {
    const journal = yield* SessionControlOperationJournal
    return yield* journal.claim({
      callerId,
      request: {
        contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
        requestId: `request-replace-${sessionId}`,
        idempotencyKey: `idempotency-replace-${sessionId}`,
        command: {
          operation: 'replace',
          sessionId,
          expectedRunId: runId,
          input: { text: 'Do this instead.', attachmentIds: [] },
        },
      },
      replacementRun: {
        caller: { callerId, idempotencyKey: `idempotency-replace-${sessionId}` },
        hostRunCeiling,
      },
      decide: (state) => ({ accepted: true, state }),
    })
  })
}

describe('Worker limits when one Run hands a Session to the next', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-worker-handover-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('defers an agent’s Follow-up after the person’s Run when the ceiling is full', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'agent-next.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* personRunAtFullCeiling([AGENT_CALLER])
        return yield* settleTarget(sql)
      }).pipe(Effect.provide(layer)),
    )

    expect(result.settled).toMatchObject({ accepted: true })
    expect(result.after.run).toEqual({ state: 'idle' })
    expect(result.after.followUpQueue).toMatchObject({
      state: 'paused',
      pauseReason: 'parent-limit',
      items: [{ id: 'queued-0' }],
    })
    expect(result.activeWorkerRuns).toBe(2)
  })

  it('delivers a queue paused for capacity once the person’s Follow-up waits in it', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'capacity-paused.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* personRunAtFullCeiling([AGENT_CALLER, 'gui:local-user'], {
          pausedForCapacity: true,
        })
        return yield* settleTarget(sql)
      }).pipe(Effect.provide(layer)),
    )

    // The agent's head goes first, as the queue delivers in order; the person's follows it.
    expect(result.after.run).toMatchObject({ state: 'starting', runId: 'run-after' })
    expect(result.after.followUpQueue).toMatchObject({
      state: 'running',
      items: [{ id: 'queued-1' }],
    })
  })

  it('refuses an agent’s replacement of the person’s Run when the ceiling is full', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'agent-replace.sqlite'))
    const claim = await Effect.runPromise(
      Effect.gen(function* () {
        yield* personRunAtFullCeiling([])
        return yield* replaceTarget(AGENT_CALLER)
      }).pipe(Effect.provide(layer)),
    )

    expect(claim).toMatchObject({
      status: 'completed',
      outcome: { operation: 'replace', effect: 'rejected', code: 'host_run_ceiling_reached' },
    })
  })

  it('lets the person replace their own Run however busy the Hive', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'person-replace.sqlite'))
    const claim = await Effect.runPromise(
      Effect.gen(function* () {
        yield* personRunAtFullCeiling([])
        return yield* replaceTarget('gui:local-user')
      }).pipe(Effect.provide(layer)),
    )

    expect(claim).toMatchObject({ status: 'claimed' })
  })

  it('passes the settling agent’s slot to the next agent’s Follow-up at a full ceiling', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'agent-to-agent.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Two Workers and this agent's Run fill a ceiling of 3; the next agent Run takes its slot.
        const sql = yield* personRunAtFullCeiling([AGENT_CALLER], { runCallerId: AGENT_CALLER })
        yield* storeHostRunCeiling(sql, 3)
        return yield* settleTarget(sql)
      }).pipe(Effect.provide(layer)),
    )

    expect(result.after.run).toMatchObject({ state: 'starting', runId: 'run-after' })
    expect(result.activeWorkerRuns).toBe(3)
  })

  it('holds the last slot for an agent’s claimed replacement until its Run starts', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'replace-race.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* personRunAtFullCeiling([])
        // One slot free: the person's two Sessions run Runs that use none.
        yield* storeHostRunCeiling(sql, 3)
        yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'session-other'}, ${'/project'})`
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
          VALUES (${'run-other'}, ${'session-other'}, ${'active'}, ${null}, ${1}, ${1})
        `
        yield* sql`
          INSERT INTO session_control_states (
            session_id, state_revision, active_run_id, queue_state, queue_revision, updated_at
          ) VALUES (${'session-other'}, ${1}, ${'run-other'}, ${'running'}, ${0}, ${1})
        `
        const first = yield* replaceTarget(AGENT_CALLER, 'session-target', 'run-target', 3)
        const second = yield* replaceTarget(AGENT_CALLER, 'session-other', 'run-other', 3)
        return { first, second, activeWorkerRuns: yield* countActiveWorkerRuns(sql) }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.first).toMatchObject({ status: 'claimed' })
    expect(result.second).toMatchObject({
      status: 'completed',
      outcome: { effect: 'rejected', code: 'host_run_ceiling_reached' },
    })
    expect(result.activeWorkerRuns).toBe(3)
  })

  it('counts an agent’s claimed replacement of the person’s Run, and never the person’s own', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'replace-count.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* personRunAtFullCeiling([])
        const before = yield* countActiveWorkerRuns(sql)
        const counted = (callerId: string) =>
          Effect.gen(function* () {
            yield* sql`DELETE FROM session_operations`
            yield* replaceTarget(callerId, 'session-target', 'run-target', 100)
            return yield* countActiveWorkerRuns(sql)
          })
        return {
          before,
          person: yield* counted('local-user:machine'),
          app: yield* counted('gui:local-user'),
          agent: yield* counted(AGENT_CALLER),
        }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({ before: 2, person: 2, app: 2, agent: 3 })
  })
})
