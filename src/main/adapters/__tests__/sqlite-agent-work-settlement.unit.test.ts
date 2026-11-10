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
 * Worker): its Run ends (at 2, `terminalStatus`) with Follow-ups from `callers` queued behind it,
 * in order and accepted at 1 unless given, in a queue paused `pausedFor` when given.
 */
type Queued = string | { readonly callerId: string; readonly acceptedAt: number }

function personRootEndingAtCeiling(
  callers: readonly Queued[],
  options: {
    readonly pausedFor?: string
    readonly terminalStatus?: 'completed' | 'failed' | 'interrupted'
    /** The Session's authority changed since the Follow-ups were queued (ADR 0057). */
    readonly authorityChanged?: boolean
  } = {},
) {
  const { pausedFor, terminalStatus = 'completed' } = options
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
    if (pausedFor) {
      yield* sql`
        UPDATE session_control_states SET queue_state = ${'paused'}, queue_pause_reason = ${pausedFor}
        WHERE session_id = ${'session-target'}
      `
    }
    for (const [position, queued] of callers.entries()) {
      const { callerId, acceptedAt } =
        typeof queued === 'string' ? { callerId: queued, acceptedAt: 1 } : queued
      const intent = {
        text: `Follow-up ${position}`,
        attachmentIds: [],
        callerId,
        acceptedAt,
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
    if (options.authorityChanged) {
      // An unreadable authority snapshot reads as changed.
      yield* sql`
        UPDATE session_execution_profiles SET authority_scope_snapshot_json = ${'not json'}
        WHERE session_id = ${'session-target'}
      `
    }
    const lifecycle = yield* SessionControlRunLifecycleRepository
    const settled = yield* lifecycle.settle({
      sessionId: SessionId('session-target'),
      runId: RunId('run-target'),
      nextRunId: RunId('run-after'),
      terminalStatus,
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
    expect(result.after.followUpQueue).toMatchObject({
      state: 'paused',
      pauseReason: 'parent-limit',
      items: [{ id: 'next-0' }],
    })
  })

  it('runs the person’s Follow-up next at a full Worker ceiling, uncounted', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'person.sqlite'))
    const result = await Effect.runPromise(
      personRootEndingAtCeiling(['gui:local-user']).pipe(Effect.provide(layer)),
    )

    expect(result.after.run).toMatchObject({ state: 'starting', runId: 'run-after' })
    expect(result.activeWorkerRuns).toBe(1)
  })

  // The person's Follow-up never waits on agents' capacity, and agents' get no slot from it.
  it('runs the person’s Follow-up ahead of an agent’s the full ceiling holds back', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'person-ahead.sqlite'))
    const result = await Effect.runPromise(
      personRootEndingAtCeiling([AGENT_CALLER, 'gui:local-user']).pipe(Effect.provide(layer)),
    )

    expect(result.after.run).toMatchObject({
      state: 'starting',
      runId: 'run-after',
      intent: { text: 'Follow-up 1' },
    })
    expect(result.after.followUpQueue).toMatchObject({
      state: 'paused',
      pauseReason: 'parent-limit',
      items: [{ id: 'next-0' }],
    })
    expect(result.activeWorkerRuns).toBe(1)
  })

  // The person sent it while their Run was active, behind a queue already waiting on capacity.
  it('runs the person’s Follow-up from a queue already waiting on capacity', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'parked.sqlite'))
    const result = await Effect.runPromise(
      personRootEndingAtCeiling([AGENT_CALLER, 'gui:local-user'], {
        pausedFor: 'parent-limit',
      }).pipe(Effect.provide(layer)),
    )

    expect(result.after.run).toMatchObject({ state: 'starting', intent: { text: 'Follow-up 1' } })
    expect(result.after.followUpQueue).toMatchObject({
      state: 'paused',
      pauseReason: 'parent-limit',
      items: [{ id: 'next-0' }],
    })
  })

  it('keeps a queue the person paused waiting', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'requested.sqlite'))
    const result = await Effect.runPromise(
      personRootEndingAtCeiling([AGENT_CALLER, 'gui:local-user'], { pausedFor: 'requested' }).pipe(
        Effect.provide(layer),
      ),
    )

    expect(result.after.run).toEqual({ state: 'idle' })
    expect(result.after.followUpQueue).toMatchObject({ state: 'paused', pauseReason: 'requested' })
  })

  // After a failure, a Follow-up accepted after it is an explicit retry.
  it('starts the person’s retry ahead of an agent’s the full ceiling holds back', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'person-retry.sqlite'))
    const result = await Effect.runPromise(
      personRootEndingAtCeiling(
        [
          { callerId: AGENT_CALLER, acceptedAt: 3 },
          { callerId: 'gui:local-user', acceptedAt: 4 },
        ],
        { terminalStatus: 'failed' },
      ).pipe(Effect.provide(layer)),
    )

    expect(result.after.run).toMatchObject({ state: 'starting', intent: { text: 'Follow-up 1' } })
    expect(result.after.followUpQueue).toMatchObject({
      state: 'paused',
      pauseReason: 'parent-limit',
      items: [{ id: 'next-0' }],
    })
    expect(result.activeWorkerRuns).toBe(1)
  })

  // The failure's pause, or the person's own, is not taken for a wait on capacity.
  it.each([
    ['the failure', undefined, 'run-failed'],
    ['the person', 'requested', 'requested'],
  ] as const)(
    'keeps %s’s pause when an agent’s retry waits on capacity',
    async (_, pausedFor, reason) => {
      const layer = makeSessionControlTestLayer(path.join(temporaryRoot, `keep-${reason}.sqlite`))
      const result = await Effect.runPromise(
        personRootEndingAtCeiling(['gui:local-user', { callerId: AGENT_CALLER, acceptedAt: 3 }], {
          ...(pausedFor ? { pausedFor } : {}),
          terminalStatus: 'failed',
        }).pipe(Effect.provide(layer)),
      )

      expect(result.after.run).toEqual({ state: 'idle' })
      expect(result.after.followUpQueue).toMatchObject({ state: 'paused', pauseReason: reason })
    },
  )

  // Stopping the person's Run makes its earlier Follow-ups wait for their Resume, not for a slot.
  it('takes the stop’s reason over a wait on capacity', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'stopped.sqlite'))
    const result = await Effect.runPromise(
      personRootEndingAtCeiling([AGENT_CALLER, 'gui:local-user'], {
        pausedFor: 'parent-limit',
        terminalStatus: 'interrupted',
      }).pipe(Effect.provide(layer)),
    )

    expect(result.after.run).toEqual({ state: 'idle' })
    expect(result.after.followUpQueue).toMatchObject({
      state: 'paused',
      pauseReason: 'run-interrupted',
    })
  })

  // Starting the person's Follow-up past capacity makes the check automatic delivery makes. A
  // changed authority holds every caller's, so the head needs attention too.
  it.each([
    ['completed', [AGENT_CALLER, 'gui:local-user'], 'parent-limit', 'next-1'],
    [
      'failed',
      [
        'gui:local-user',
        { callerId: AGENT_CALLER, acceptedAt: 3 },
        { callerId: 'gui:local-user', acceptedAt: 4 },
      ],
      undefined,
      'next-2',
    ],
  ] as const)(
    'holds the person’s Follow-up whose authority changed after a %s Run',
    async (terminalStatus, callers, pausedFor, held) => {
      const layer = makeSessionControlTestLayer(
        path.join(temporaryRoot, `auth-${terminalStatus}.sqlite`),
      )
      const result = await Effect.runPromise(
        personRootEndingAtCeiling(callers, {
          ...(pausedFor ? { pausedFor } : {}),
          terminalStatus,
          authorityChanged: true,
        }).pipe(Effect.provide(layer)),
      )

      expect(result.after.run).toEqual({ state: 'idle' })
      expect(result.after.followUpQueue.state).toBe('paused')
      expect(result.after.followUpQueue.items).toContainEqual(
        expect.objectContaining({
          id: held,
          deliveryState: 'needs_attention',
          attentionReason: 'authority_changed',
        }),
      )
    },
  )
})
