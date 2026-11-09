import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { loadSessionControlState } from '../sqlite-session-control-state'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'
import {
  AGENT_CALLER,
  makeTargetAWorker,
  seedHive,
} from './sqlite-worker-run-admission.test-support'

let temporaryRoot = ''

/**
 * `session-target` as a Worker at its parent's limit of one: its own Run ends while a sibling
 * still runs, with a Follow-up from each of `callerIds` queued behind it, in order.
 */
function workerEndingAtParentLimit(...callerIds: readonly string[]) {
  return workerSettlingAtParentLimit({ callerIds, terminalStatus: 'completed' })
}

/** As `workerEndingAtParentLimit`, with how the Run ended and when each Follow-up was sent. */
function workerSettlingAtParentLimit(input: {
  readonly callerIds: readonly string[]
  readonly terminalStatus: 'completed' | 'failed'
  readonly acceptedAfterEnd?: boolean
}) {
  const { callerIds } = input
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* seedHive(sql, 1)
    yield* sql`
      UPDATE settings_store SET value_json = ${'1'}
      WHERE key = ${'sessionHostParentConcurrencyLimit'}
    `
    yield* makeTargetAWorker(sql)
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
    yield* sql`
      INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
      VALUES (${'run-target'}, ${'session-target'}, ${'active'}, ${null}, ${1}, ${1})
    `
    yield* sql`
      UPDATE session_control_states SET active_run_id = ${'run-target'}, state_revision = ${1}
      WHERE session_id = ${'session-target'}
    `
    for (const [position, callerId] of callerIds.entries()) {
      const id = position === 0 ? 'next' : `next-${position}`
      const intent = {
        text: 'Next, please.',
        attachmentIds: [],
        callerId,
        // Sent after the Run was seen to end (at 2): a failed Run's explicit retry.
        acceptedAt: input.acceptedAfterEnd ? position + 10 : position + 1,
        idempotencyKey: `key-${id}`,
      }
      yield* sql`
        INSERT INTO session_follow_ups (
          id, session_id, position, delivery_state, intent_json, created_at, updated_at
        ) VALUES (
          ${id}, ${'session-target'}, ${position}, ${'pending'}, ${JSON.stringify(intent)}, ${1}, ${1}
        )
      `
    }
    const lifecycle = yield* SessionControlRunLifecycleRepository
    const settled = yield* lifecycle.settle({
      sessionId: SessionId('session-target'),
      runId: RunId('run-target'),
      nextRunId: RunId('run-after'),
      terminalStatus: input.terminalStatus,
      terminalEventAt: 2,
    })
    return { settled, after: yield* loadSessionControlState(sql, 'session-target') }
  })
}

describe('Worker Run admission when a Run settles', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-worker-settle-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('runs the person’s queued Follow-up next in a Worker at its parent’s limit', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'person-settle.sqlite'))
    const result = await Effect.runPromise(
      workerEndingAtParentLimit('gui:local-user').pipe(Effect.provide(layer)),
    )

    expect(result.settled).toMatchObject({ accepted: true })
    expect(result.after.run).toMatchObject({ state: 'starting', runId: 'run-after' })
  })

  it('defers an agent’s queued Follow-up in a Worker at its parent’s limit', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'agent-settle.sqlite'))
    const result = await Effect.runPromise(
      workerEndingAtParentLimit(AGENT_CALLER).pipe(Effect.provide(layer)),
    )

    expect(result.settled).toMatchObject({ accepted: true })
    expect(result.after.run).toEqual({ state: 'idle' })
    expect(result.after.followUpQueue).toMatchObject({
      state: 'paused',
      pauseReason: 'parent-limit',
      items: [{ id: 'next' }],
    })
  })

  it('runs an agent’s Follow-up next when the person’s waits behind it at the parent’s limit', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'agent-then-person.sqlite'))
    const result = await Effect.runPromise(
      workerEndingAtParentLimit(AGENT_CALLER, 'gui:local-user').pipe(Effect.provide(layer)),
    )

    // Holding the agent's head back would hold back the person's message behind it.
    expect(result.after.run).toMatchObject({ state: 'starting', runId: 'run-after' })
    expect(result.after.followUpQueue).toMatchObject({
      state: 'running',
      items: [{ id: 'next-1' }],
    })
  })

  it('pauses nothing when a Worker’s Run ends at its parent’s limit and nothing would start', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'nothing-next.sqlite'))
    const result = await Effect.runPromise(workerEndingAtParentLimit().pipe(Effect.provide(layer)))

    // A later Follow-up of the person's into this idle Worker must not find a capacity pause.
    expect(result.after.run).toEqual({ state: 'idle' })
    expect(result.after.followUpQueue).toMatchObject({ state: 'running', items: [] })
  })

  it('keeps a failed Run’s pause reason when its agent retry waits at the parent’s limit', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'failed-retry.sqlite'))
    const result = await Effect.runPromise(
      workerSettlingAtParentLimit({
        callerIds: [AGENT_CALLER],
        terminalStatus: 'failed',
        acceptedAfterEnd: true,
      }).pipe(Effect.provide(layer)),
    )

    expect(result.after.run).toEqual({ state: 'idle' })
    expect(result.after.followUpQueue).toMatchObject({ state: 'paused', pauseReason: 'run-failed' })
  })
})
