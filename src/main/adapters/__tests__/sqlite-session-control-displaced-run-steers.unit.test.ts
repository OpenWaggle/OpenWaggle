import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import {
  directSteer,
  layer,
  prepareRunWithTwoFollowUps,
  readQueue,
  undelivered,
} from './sqlite-session-control-undelivered-steering.test-support'

const PROMOTION_COMPLETION_DELAY_MS = 150

function settleStoppedRun() {
  return Effect.gen(function* () {
    const lifecycle = yield* SessionControlRunLifecycleRepository
    return yield* lifecycle.settle({
      sessionId: SessionId('session-target'),
      runId: RunId('run-next'),
      nextRunId: RunId('run-after'),
      terminalStatus: 'interrupted',
      undeliveredSteers: undelivered,
    })
  })
}

describe('SQLite settlement of a displaced Run with Undelivered steering messages', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-displaced-steers-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('returns the steers of a Run an explicit Waggle replaced before it settled', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* prepareRunWithTwoFollowUps()
        if (!lifecycle.replaceWithExternal) {
          return yield* Effect.die('external replacement lifecycle unavailable')
        }
        yield* lifecycle.replaceWithExternal({
          sessionId: SessionId('session-target'),
          previousRunId: RunId('run-next'),
          runId: RunId('waggle-run'),
          intent: {
            text: 'Use Waggle.',
            attachmentIds: [],
            callerId: 'gui:local-user',
            acceptedAt: 2000,
            idempotencyKey: 'waggle-once',
          },
        })
        const before = yield* readQueue()
        const settlement = yield* settleStoppedRun()
        return { before, settlement, after: yield* readQueue() }
      }).pipe(Effect.provide(layer(path.join(temporaryRoot, 'waggle.sqlite')))),
    )

    expect(result.after.followUps).toEqual(['follow-up-direct-steer', 'follow-up-3', 'follow-up-2'])
    expect(result.after.intents.get('follow-up-direct-steer')).toEqual(directSteer.intent)
    expect(result.after.state?.state_revision).toBe((result.before.state?.state_revision ?? 0) + 1)
    expect(result.settlement).toEqual({
      accepted: false,
      code: 'run_changed',
      stateRevision: result.after.state?.state_revision,
    })
    // The Waggle Run owns the Session now and delivers the queue when it settles.
    expect(result.after.state?.queue_state).toBe('running')
  })

  it('pauses returned steers when the Session already has no Run to deliver them', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* prepareRunWithTwoFollowUps()
        const sql = yield* SqlClient.SqlClient
        // A refused interruption already released the Run without settling it.
        yield* sql`UPDATE session_runs SET status = ${'interrupted'} WHERE id = ${'run-next'}`
        yield* sql`
          UPDATE session_control_states SET active_run_id = ${null}
          WHERE session_id = ${'session-target'}
        `
        const settlement = yield* settleStoppedRun()
        return { settlement, after: yield* readQueue() }
      }).pipe(Effect.provide(layer(path.join(temporaryRoot, 'idle.sqlite')))),
    )

    expect(result.settlement).toMatchObject({ accepted: false, code: 'run_not_active' })
    expect(result.after.followUps).toEqual(['follow-up-direct-steer', 'follow-up-3', 'follow-up-2'])
    expect(result.after.state).toMatchObject({
      queue_state: 'paused',
      queue_pause_reason: 'run-interrupted',
    })
  })

  it('returns the steers once a pending promotion completes during settlement retries', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* prepareRunWithTwoFollowUps()
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_operations (
            caller_id, operation, target_scope, idempotency_key, request_json,
            status, outcome_json, created_at, updated_at
          ) VALUES (
            ${'local-user'}, ${'promote'}, ${'session-target'}, ${'pending-promotion'},
            ${JSON.stringify({
              operation: 'promote',
              sessionId: 'session-target',
              expectedRunId: 'run-next',
              followUpId: 'follow-up-3',
            })}, ${'pending'}, ${null}, ${1000}, ${1000}
          )
        `
        const completePromotion = Effect.sleep(PROMOTION_COMPLETION_DELAY_MS).pipe(
          Effect.zipRight(sql`
            UPDATE session_operations
            SET status = ${'completed'},
              outcome_json = ${JSON.stringify({
                operation: 'promote',
                effect: 'rejected',
                sessionId: 'session-target',
                code: 'run_not_live',
              })}
            WHERE idempotency_key = ${'pending-promotion'}
          `),
        )
        const [settlement] = yield* Effect.all([settleStoppedRun(), completePromotion], {
          concurrency: 'unbounded',
        })
        return { settlement, after: yield* readQueue() }
      }).pipe(Effect.provide(layer(path.join(temporaryRoot, 'promotion.sqlite')))),
    )

    expect(result.settlement).toMatchObject({ accepted: true })
    expect(result.after.followUps).toEqual(['follow-up-direct-steer', 'follow-up-3', 'follow-up-2'])
    expect(result.after.state).toMatchObject({ queue_state: 'paused' })
  })
})
