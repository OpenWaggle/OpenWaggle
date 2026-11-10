import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { loadSessionControlState } from '../sqlite-session-control-state'
import { countActiveWorkerRuns } from '../sqlite-worker-run-admission'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'
import { AGENT_CALLER, seedHive } from './sqlite-worker-run-admission.test-support'

let temporaryRoot = ''

/**
 * `session-target` as a root the person made, at a full Active Workers of one (the Queen's one
 * Worker): its Run ends with Follow-ups from `callers` queued behind it, in order.
 */
function personRootEndingAtCeiling(callers: readonly string[]) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* seedHive(sql, 1)
    yield* sql`
      INSERT INTO settings_store (key, value_json, updated_at)
      VALUES (${'sessionHostRunCeiling'}, ${'1'}, ${1})
    `
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
    for (const [position, callerId] of callers.entries()) {
      const intent = {
        text: `Follow-up ${position}`,
        attachmentIds: [],
        callerId,
        acceptedAt: 1,
        idempotencyKey: `key-${position}`,
      }
      yield* sql`
        INSERT INTO session_follow_ups (
          id, session_id, position, delivery_state, intent_json, created_at, updated_at
        ) VALUES (
          ${`next-${position}`}, ${'session-target'}, ${position}, ${'pending'},
          ${JSON.stringify(intent)}, ${1}, ${1}
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
    return {
      settled,
      after: yield* loadSessionControlState(sql, 'session-target'),
      activeWorkerRuns: yield* countActiveWorkerRuns(sql),
    }
  })
}

describe('an agent’s Follow-up in the person’s Session when a Run settles', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agent-work-settle-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('defers an agent’s Follow-up at a full Worker ceiling', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'agent.sqlite'))
    const result = await Effect.runPromise(
      personRootEndingAtCeiling([AGENT_CALLER]).pipe(Effect.provide(layer)),
    )

    expect(result.settled).toMatchObject({ accepted: true })
    expect(result.after.run).toEqual({ state: 'idle' })
    expect(result.after.followUpQueue).toMatchObject({ state: 'paused', items: [{ id: 'next-0' }] })
  })

  it('runs the person’s Follow-up next at a full Worker ceiling, uncounted', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'person.sqlite'))
    const result = await Effect.runPromise(
      personRootEndingAtCeiling(['gui:local-user']).pipe(Effect.provide(layer)),
    )

    expect(result.after.run).toMatchObject({ state: 'starting', runId: 'run-after' })
    expect(result.activeWorkerRuns).toBe(1)
  })

  // Holding the agent's head back would hold back the person's Follow-up behind it.
  it('runs an agent’s Follow-up the person’s waits behind, and counts it', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'in-order.sqlite'))
    const result = await Effect.runPromise(
      personRootEndingAtCeiling([AGENT_CALLER, 'gui:local-user']).pipe(Effect.provide(layer)),
    )

    expect(result.after.run).toMatchObject({ state: 'starting', runId: 'run-after' })
    expect(result.after.followUpQueue).toMatchObject({
      state: 'running',
      items: [{ id: 'next-1' }],
    })
    expect(result.activeWorkerRuns).toBe(2)
  })
})
