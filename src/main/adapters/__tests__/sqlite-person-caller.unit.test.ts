import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { submitSessionMessage } from '../../application/session-control-service'
import { scheduledTaskRunKey } from '../../domain/scheduled-tasks/scheduled-task-run-key'
import { isPersonCaller } from '../sqlite-worker-run-admission'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'
import {
  AGENT_CALLER,
  makeTargetAWorker,
  messageRequest,
  seedHive,
  seedScheduledFiring,
} from './sqlite-worker-run-admission.test-support'

let temporaryRoot = ''

function layer(name: string) {
  return makeSessionControlTestLayer(path.join(temporaryRoot, name))
}

/** A Heartbeat firing into `session-target`, a Worker at a full ceiling, as its owner. */
function heartbeatIntoFullWorker(creatorKind: 'local-user' | 'session-agent') {
  const key = scheduledTaskRunKey('fired')
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* seedHive(sql, 2)
    yield* makeTargetAWorker(sql)
    yield* seedScheduledFiring(sql, key, creatorKind)
    return yield* submitSessionMessage({
      callerId: 'local-user',
      hostRunCeiling: 2,
      request: { ...messageRequest('session-target', 'heartbeat'), idempotencyKey: key },
    })
  })
}

describe('isPersonCaller', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-person-caller-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('is the person from the app, the CLI or another local-user client', async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* Effect.all(
          ['gui:local-user', 'local-user', 'local-user:machine'].map((callerId) =>
            isPersonCaller(sql, { callerId, idempotencyKey: 'typed-by-hand' }),
          ),
        )
      }).pipe(Effect.provide(layer('person.sqlite'))),
    )

    expect(results).toEqual([true, true, true])
  })

  it('is not an agent, a client profile, or the Host waking a parent for the person', async () => {
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* Effect.all([
          isPersonCaller(sql, { callerId: 'session-agent:queen:run-queen' }),
          isPersonCaller(sql, { callerId: 'profile:ci' }),
          isPersonCaller(sql, { callerId: AGENT_CALLER }),
          isPersonCaller(sql, { callerId: 'gui:local-user', hiveWake: true }),
        ])
      }).pipe(Effect.provide(layer('not-person.sqlite'))),
    )

    expect(results).toEqual([false, false, false, false])
  })

  it('holds an agent-created Heartbeat to the Worker limits, though it fires as the owner', async () => {
    const result = await Effect.runPromise(
      heartbeatIntoFullWorker('session-agent').pipe(Effect.provide(layer('agent-task.sqlite'))),
    )

    expect(result.outcome).toMatchObject({
      effect: 'rejected',
      code: 'host_run_ceiling_reached',
    })
  })

  it('starts a Heartbeat the person created, however busy the Hive', async () => {
    const result = await Effect.runPromise(
      heartbeatIntoFullWorker('local-user').pipe(Effect.provide(layer('person-task.sqlite'))),
    )

    expect(result.outcome).toMatchObject({ effect: 'started-run' })
  })
})
