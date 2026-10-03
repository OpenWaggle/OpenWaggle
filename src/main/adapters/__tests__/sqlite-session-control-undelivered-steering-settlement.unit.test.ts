import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  directSteer,
  insertPendingReplacement,
  layer,
  prepareRunWithTwoFollowUps,
  readQueue,
  undelivered,
} from './sqlite-session-control-undelivered-steering.test-support'

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

  it('returns steers while a pending replacement takes over, at their own state revision', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* prepareRunWithTwoFollowUps()
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE session_runs SET status = ${'stopping'} WHERE id = ${'run-next'}`
        yield* insertPendingReplacement(sql)
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

    expect(result.after.followUps).toEqual(['follow-up-direct-steer', 'follow-up-3', 'follow-up-2'])
    expect(result.after.state?.state_revision).toBe((result.before.state?.state_revision ?? 0) + 1)
    expect(result.settlement).toEqual({
      accepted: false,
      code: 'run_not_active',
      stateRevision: result.after.state?.state_revision,
    })
    expect(result.after.state?.queue_state).toBe('running')
  })
})
