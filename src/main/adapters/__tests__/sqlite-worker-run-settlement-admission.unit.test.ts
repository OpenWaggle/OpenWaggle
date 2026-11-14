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
 * still runs, with one Follow-up from `callerId` queued behind it, or none. With `limit` set to
 * `ceiling`, the full limit is an Active Workers of one instead.
 */
function workerEndingAtParentLimit(
  callerId: string,
  queued = true,
  limit: 'parent' | 'ceiling' = 'parent',
) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* seedHive(sql, 1)
    if (limit === 'parent') {
      yield* sql`
        UPDATE settings_store SET value_json = ${'1'}
        WHERE key = ${'sessionHostParentConcurrencyLimit'}
      `
    } else {
      yield* sql`
        INSERT INTO settings_store (key, value_json, updated_at)
        VALUES (${'sessionHostRunCeiling'}, ${'1'}, ${1})
      `
    }
    yield* makeTargetAWorker(sql)
    // Delivery re-checks a Follow-up's authority against the target's execution profile.
    yield* sql`
      INSERT INTO session_execution_profiles (
        session_id, profile_json, authority_origin_caller_id,
        authorization_ceiling, created_at, updated_at
      ) VALUES (
        ${'session-target'}, ${'{"modelId":"provider/model","thinkingLevel":"medium"}'},
        ${callerId}, ${'ask-for-approval'}, ${1}, ${1}
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
    const intent = {
      text: 'Next, please.',
      attachmentIds: [],
      callerId,
      acceptedAt: 1,
      idempotencyKey: 'key-next',
    }
    if (queued) {
      yield* sql`
      INSERT INTO session_follow_ups (
        id, session_id, position, delivery_state, intent_json, created_at, updated_at
      ) VALUES (
        ${'next'}, ${'session-target'}, ${0}, ${'pending'}, ${JSON.stringify(intent)}, ${1}, ${1}
      )
    `
    }
    const lifecycle = yield* SessionControlRunLifecycleRepository

    const settled = yield* lifecycle.settle({
      sessionId: SessionId('session-target'),
      runId: RunId('run-target'),
      nextRunId: RunId('run-after'),
      terminalStatus: 'completed',
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

  // Nothing would start, so nothing waits: a pause here would outlast the limit and hold back
  // the Follow-ups the person queues later.
  it('leaves an empty Worker queue running at its parent’s limit', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'empty-settle.sqlite'))
    const result = await Effect.runPromise(
      workerEndingAtParentLimit(AGENT_CALLER, false).pipe(Effect.provide(layer)),
    )

    expect(result.settled).toMatchObject({ accepted: true })
    expect(result.after.run).toEqual({ state: 'idle' })
    expect(result.after.followUpQueue).toMatchObject({ state: 'running', items: [] })
  })

  // A Run the person started there may have passed the ceiling; it is not handed on to agents.
  it.each([
    ['defers an agent’s', AGENT_CALLER, 'idle'],
    ['runs the person’s', 'gui:local-user', 'starting'],
  ])('%s queued Follow-up in a Worker at the Worker ceiling', async (_, callerId, run) => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, `ceiling-${run}.sqlite`))
    const result = await Effect.runPromise(
      workerEndingAtParentLimit(callerId, true, 'ceiling').pipe(Effect.provide(layer)),
    )

    expect(result.settled).toMatchObject({ accepted: true })
    expect(result.after.run.state).toBe(run)
    if (run === 'idle') {
      expect(result.after.followUpQueue).toMatchObject({
        state: 'paused',
        pauseReason: 'parent-limit',
        items: [{ id: 'next' }],
      })
    }
  })
})
