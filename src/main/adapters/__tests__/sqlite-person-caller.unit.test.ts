import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { submitSessionMessage } from '../../application/session-control-service'
import { scheduledTaskRunKey } from '../../domain/scheduled-tasks/scheduled-task-run-key'
import { countActiveWorkerRuns, isPersonCaller } from '../sqlite-worker-run-admission'
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

/**
 * A Heartbeat firing into `session-target` at a full ceiling, as its owner: `work` is whose work
 * the firing's key marks (undefined: a key from before keys were marked), `creatorKind` who made
 * the task, and `inWorker` whether the target is a Worker.
 */
function heartbeatAtFullCeiling(
  work: 'person' | 'agents' | undefined,
  creatorKind: 'local-user' | 'session-agent',
  options: { readonly inWorker?: boolean; readonly taskDeleted?: boolean } = {},
) {
  const key = work ? scheduledTaskRunKey('fired', work) : 'scheduled-task-run:fired'
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* seedHive(sql, 2)
    if (options.inWorker ?? true) yield* makeTargetAWorker(sql)
    yield* seedScheduledFiring(sql, key, creatorKind)
    if (options.taskDeleted) yield* sql`DELETE FROM scheduled_tasks`
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
          // A profile's request gains nothing from a key marked as the person's.
          isPersonCaller(sql, {
            callerId: 'profile:ci',
            idempotencyKey: scheduledTaskRunKey('forged', 'person'),
          }),
        ])
      }).pipe(Effect.provide(layer('not-person.sqlite'))),
    )

    expect(results).toEqual([false, false, false, false, false])
  })

  it('holds an agent-created Heartbeat to the Worker limits, though it fires as the owner', async () => {
    const result = await Effect.runPromise(
      heartbeatAtFullCeiling('agents', 'session-agent').pipe(
        Effect.provide(layer('agent-task.sqlite')),
      ),
    )

    expect(result.outcome).toMatchObject({
      effect: 'rejected',
      code: 'host_run_ceiling_reached',
    })
  })

  it('starts a Heartbeat the person created, however busy the Hive', async () => {
    const result = await Effect.runPromise(
      heartbeatAtFullCeiling('person', 'local-user').pipe(
        Effect.provide(layer('person-task.sqlite')),
      ),
    )

    expect(result.outcome).toMatchObject({ effect: 'started-run' })
  })

  it('counts a root’s active Run that an agent’s task fired, and not one the person’s did', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const count = (key: string, creatorKind: 'local-user' | 'session-agent') =>
          Effect.gen(function* () {
            yield* seedScheduledFiring(sql, key, creatorKind)
            const intent = {
              text: 'Fired.',
              attachmentIds: [],
              callerId: 'local-user',
              acceptedAt: 1,
              idempotencyKey: key,
            }
            yield* sql`
              INSERT INTO session_runs (id, session_id, status, intent_json, created_at, updated_at)
              VALUES (${`run-${key}`}, ${'session-target'}, ${'active'}, ${JSON.stringify(intent)}, ${1}, ${1})
            `
            yield* sql`
              UPDATE session_control_states SET active_run_id = ${`run-${key}`}
              WHERE session_id = ${'session-target'}
            `
            return yield* countActiveWorkerRuns(sql)
          })
        return {
          person: yield* count(scheduledTaskRunKey('person', 'person'), 'local-user'),
          agent: yield* count(scheduledTaskRunKey('agent', 'agents'), 'session-agent'),
        }
      }).pipe(Effect.provide(layer('task-count.sqlite'))),
    )

    expect(result).toEqual({ person: 0, agent: 1 })
  })

  it('starts the person’s Run now of an agent’s task in a root at a full ceiling', async () => {
    const result = await Effect.runPromise(
      heartbeatAtFullCeiling('person', 'session-agent', { inWorker: false }).pipe(
        Effect.provide(layer('person-run-now.sqlite')),
      ),
    )

    expect(result.outcome).toMatchObject({ effect: 'started-run' })
  })

  it('holds an agent’s firing to the limits by its key, even once its task is deleted', async () => {
    const result = await Effect.runPromise(
      heartbeatAtFullCeiling('agents', 'session-agent', {
        inWorker: false,
        taskDeleted: true,
      }).pipe(Effect.provide(layer('agent-task-deleted.sqlite'))),
    )

    expect(result.outcome).toMatchObject({ effect: 'rejected', code: 'host_run_ceiling_reached' })
  })

  it('judges a firing from before keys were marked by its task', async () => {
    const result = await Effect.runPromise(
      heartbeatAtFullCeiling(undefined, 'session-agent', { inWorker: false }).pipe(
        Effect.provide(layer('legacy-key.sqlite')),
      ),
    )

    expect(result.outcome).toMatchObject({ effect: 'rejected', code: 'host_run_ceiling_reached' })
  })
})
