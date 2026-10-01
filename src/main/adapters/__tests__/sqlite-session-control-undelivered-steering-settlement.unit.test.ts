import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionControlFollowUp } from '../../domain/session-control/message-aggregate'
import type { UndeliveredSteer } from '../../domain/session-control/undelivered-steering'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { makeSessionControlRunLifecycleTestLayer } from './sqlite-session-control-run-lifecycle-test-layer'
import { queueFollowUp, submitMessage } from './sqlite-session-control-settlement-test-support'

const directSteer: SessionControlFollowUp = {
  id: FollowUpId('follow-up-direct-steer'),
  deliveryState: 'pending',
  intent: {
    text: 'Also check the migration rollback.',
    attachmentIds: ['attachment-steer'],
    visualizationContext: { title: 'Plan', sourcePath: '/repo/plan.html', state: { step: 2 } },
    callerId: 'session-agent:queen',
    acceptedAt: 1500,
    idempotencyKey: 'idempotency-direct-steer',
  },
}

function layer(databasePath: string) {
  let followUpCount = 0
  return makeSessionControlRunLifecycleTestLayer(databasePath, {
    nextFollowUpId: Effect.sync(() => {
      followUpCount += 1
      return FollowUpId(`follow-up-${followUpCount}`)
    }),
  })
}

/** A started Run with Follow-ups `follow-up-2` ("First queued.") and `follow-up-3` (the message start takes `follow-up-1`). */
function prepareRunWithTwoFollowUps() {
  return Effect.gen(function* () {
    yield* submitMessage('Start working.', 'start')
    yield* queueFollowUp('First queued.', 'first')
    yield* queueFollowUp('Promoted, then stopped.', 'second')
    const lifecycle = yield* SessionControlRunLifecycleRepository
    yield* lifecycle.activate({ sessionId: SessionId('session-target'), runId: RunId('run-next') })
    return lifecycle
  })
}

function readQueue() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [state] = yield* sql<{
      readonly state_revision: number
      readonly queue_state: string
      readonly queue_pause_reason: string | null
      readonly queue_revision: number
    }>`
      SELECT state_revision, queue_state, queue_pause_reason, queue_revision
      FROM session_control_states WHERE session_id = ${'session-target'}
    `
    const followUps = yield* sql<{ readonly id: string; readonly intent_json: string }>`
      SELECT id, intent_json FROM session_follow_ups ORDER BY position
    `
    return {
      state,
      followUps: followUps.map((row) => row.id),
      intents: new Map(followUps.map((row) => [row.id, JSON.parse(row.intent_json)])),
    }
  })
}

const undelivered: readonly UndeliveredSteer[] = [
  { delivery: { kind: 'steer', followUp: directSteer }, handedOff: true },
  {
    delivery: { kind: 'promoted-follow-up', followUpId: FollowUpId('follow-up-3') },
    handedOff: true,
  },
]

describe('SQLite settlement of Undelivered steering messages', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-undelivered-steers-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('returns stopped steers to the front of the paused queue in steering order', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* prepareRunWithTwoFollowUps()
        const before = yield* readQueue()
        const settlement = yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'interrupted',
          undeliveredSteers: undelivered,
        })
        return { before, settlement, after: yield* readQueue() }
      }).pipe(Effect.provide(layer(path.join(temporaryRoot, 'interrupted.sqlite')))),
    )

    expect(result.settlement).toEqual({
      accepted: true,
      stateRevision: result.after.state?.state_revision,
    })
    expect(result.after.followUps).toEqual(['follow-up-direct-steer', 'follow-up-3', 'follow-up-2'])
    expect(result.after.state).toMatchObject({
      queue_state: 'paused',
      queue_pause_reason: 'run-interrupted',
    })
    expect(result.after.state?.queue_revision).toBeGreaterThan(
      result.before.state?.queue_revision ?? Number.POSITIVE_INFINITY,
    )
    expect(result.after.intents.get('follow-up-direct-steer')).toEqual(directSteer.intent)
    expect(result.after.intents.get('follow-up-3')).toEqual(
      result.before.intents.get('follow-up-3'),
    )
  })

  it('starts a steer the completed Run never incorporated as the next Follow-up', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* prepareRunWithTwoFollowUps()
        const settlement = yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'completed',
          undeliveredSteers: [undelivered[0]].flatMap((steer) => (steer ? [steer] : [])),
        })
        return { settlement, after: yield* readQueue() }
      }).pipe(Effect.provide(layer(path.join(temporaryRoot, 'completed.sqlite')))),
    )

    expect(result.settlement).toMatchObject({
      accepted: true,
      scheduled: {
        followUpId: 'follow-up-direct-steer',
        runId: 'run-after',
        intent: directSteer.intent,
      },
    })
    expect(result.after.followUps).toEqual(['follow-up-2', 'follow-up-3'])
  })

  it('leaves the state revision to a pending replacement while returning its steers', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* prepareRunWithTwoFollowUps()
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE session_runs SET status = ${'stopping'} WHERE id = ${'run-next'}`
        yield* sql`
          INSERT INTO session_operations (
            caller_id, operation, target_scope, idempotency_key, request_json,
            status, outcome_json, created_at, updated_at
          ) VALUES (
            ${'local-user'}, ${'replace'}, ${'session-target'}, ${'replace-key'},
            ${JSON.stringify({
              operation: 'replace',
              sessionId: 'session-target',
              expectedRunId: 'run-next',
              input: { text: 'Replacement.', attachmentIds: [] },
            })}, ${'pending'}, ${null}, ${1000}, ${1000}
          )
        `
        const before = yield* readQueue()
        const settlement = yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'interrupted',
          undeliveredSteers: undelivered,
        })
        return { before, settlement, after: yield* readQueue() }
      }).pipe(Effect.provide(layer(path.join(temporaryRoot, 'replacement.sqlite')))),
    )

    expect(result.settlement).toEqual({ accepted: false, code: 'run_not_active' })
    expect(result.after.followUps).toEqual(['follow-up-direct-steer', 'follow-up-3', 'follow-up-2'])
    expect(result.after.state?.state_revision).toBe(result.before.state?.state_revision)
    expect(result.after.state?.queue_revision).toBe((result.before.state?.queue_revision ?? 0) + 1)
    expect(result.after.state?.queue_state).toBe('running')
  })
})
