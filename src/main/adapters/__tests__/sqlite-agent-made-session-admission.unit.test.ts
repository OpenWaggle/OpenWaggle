import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { submitSessionMessage } from '../../application/session-control-service'
import { scheduledTaskRunKey } from '../../domain/scheduled-tasks/scheduled-task-run-key'
import { newRunAdmissionRefusal } from '../sqlite-session-control-queue-delivery'
import { loadSessionControlState } from '../sqlite-session-control-state'
import { countActiveWorkerRuns, isPersonStartedRun } from '../sqlite-worker-run-admission'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'
import {
  AGENT_CALLER,
  makeTargetAWorker,
  messageRequest,
  seedHive,
  targetRunCount,
} from './sqlite-worker-run-admission.test-support'

let temporaryRoot = ''

/** Records that `callerId` launched `session-target` with a request keyed `idempotencyKey`. */
function targetLaunchedBy(
  sql: SqlClient.SqlClient,
  callerId: string,
  idempotencyKey = 'idempotency-launch-target',
) {
  return sql`
    INSERT INTO session_operations (
      caller_id, operation, target_scope, idempotency_key, request_json,
      status, outcome_json, created_at, updated_at
    ) VALUES (
      ${callerId}, ${'launch'}, ${'/project'}, ${idempotencyKey}, ${'{}'}, ${'completed'},
      ${JSON.stringify({ operation: 'launch', effect: 'launched-root', sessionId: 'session-target' })},
      ${1}, ${1}
    )
  `
}

/** `sessionId`'s state as if a Host-authored Hive wake were starting its next Run. */
function wakeStarting(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.map(loadSessionControlState(sql, sessionId), (state) => ({
    ...state,
    run: {
      state: 'starting' as const,
      runId: RunId(`run-wake-${sessionId}`),
      intent: {
        text: 'A Worker reported.',
        attachmentIds: [],
        callerId: 'gui:local-user',
        acceptedAt: 1,
        idempotencyKey: `wake-${sessionId}`,
        hiveWake: true as const,
      },
    },
  }))
}

describe('Admission for Sessions agents made', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agent-made-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('holds a root an agent launched to the Worker ceiling, and counts its Run', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'agent-root.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 2)
        yield* targetLaunchedBy(sql, 'session-agent:queen:run-queen')
        const agent = yield* submitSessionMessage({
          callerId: AGENT_CALLER,
          hostRunCeiling: 2,
          request: messageRequest('session-target', 'agent'),
        })
        const agentRuns = yield* targetRunCount(sql)
        const person = yield* submitSessionMessage({
          callerId: 'gui:local-user',
          hostRunCeiling: 2,
          request: messageRequest('session-target', 'person'),
        })
        return { agent, agentRuns, person, counted: yield* countActiveWorkerRuns(sql) }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.agent.outcome).toMatchObject({
      effect: 'rejected',
      code: 'host_run_ceiling_reached',
    })
    expect(result.agentRuns).toBe(0)
    expect(result.person.outcome).toMatchObject({ effect: 'started-run' })
    expect(result.counted).toBe(3)
  })

  it('does not count a root the person launched, from the app, the CLI or their own task', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'person-roots.sqlite'))
    const counted = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 1)
        yield* targetLaunchedBy(sql, 'local-user', scheduledTaskRunKey('run-1', 'local-user'))
        yield* submitSessionMessage({
          callerId: 'gui:local-user',
          request: messageRequest('session-target', 'person'),
        })
        return yield* countActiveWorkerRuns(sql)
      }).pipe(Effect.provide(layer)),
    )

    expect(counted).toBe(1)
  })

  it('counts a root a Session agent’s Scheduled task launched as the person', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'agent-task.sqlite'))
    const counted = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 1)
        yield* targetLaunchedBy(sql, 'local-user', scheduledTaskRunKey('run-1', 'session-agent'))
        yield* submitSessionMessage({
          callerId: 'gui:local-user',
          request: messageRequest('session-target', 'person'),
        })
        return yield* countActiveWorkerRuns(sql)
      }).pipe(Effect.provide(layer)),
    )

    expect(counted).toBe(2)
  })

  it('starts a Hive wake of a top-level Queen while every Worker slot is taken', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'wake-root.sqlite'))
    const refusal = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 16)
        return yield* newRunAdmissionRefusal(sql, yield* wakeStarting(sql, 'session-target'), 16)
      }).pipe(Effect.provide(layer)),
    )

    expect(refusal).toBeUndefined()
  })

  it('holds a Hive wake of a nested Queen, a Worker, to the Worker ceiling', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'wake-worker.sqlite'))
    const refusal = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 2)
        yield* makeTargetAWorker(sql)
        return yield* newRunAdmissionRefusal(sql, yield* wakeStarting(sql, 'session-target'), 2)
      }).pipe(Effect.provide(layer)),
    )

    expect(refusal).toBe('host_run_ceiling_reached')
  })
})

describe('isPersonStartedRun', () => {
  it('is the person from the app, the CLI, another local-user client or their own task', () => {
    expect(isPersonStartedRun({ callerId: 'gui:local-user' })).toBe(true)
    expect(isPersonStartedRun({ callerId: 'local-user' })).toBe(true)
    expect(isPersonStartedRun({ callerId: 'local-user:machine' })).toBe(true)
    const ownTask = scheduledTaskRunKey('run-1', 'local-user')
    expect(isPersonStartedRun({ callerId: 'local-user', idempotencyKey: ownTask })).toBe(true)
  })

  it('is the person’s queue action, whoever wrote the Follow-up it delivers', () => {
    expect(isPersonStartedRun({ callerId: AGENT_CALLER, personActed: true })).toBe(true)
  })

  it('is not an agent, a profile, the Host’s wake, or a Session agent’s task run as the person', () => {
    expect(isPersonStartedRun({ callerId: 'session-agent:queen:run-queen' })).toBe(false)
    expect(isPersonStartedRun({ callerId: 'profile:ci' })).toBe(false)
    expect(isPersonStartedRun({ callerId: AGENT_CALLER })).toBe(false)
    expect(isPersonStartedRun({ callerId: 'gui:local-user', hiveWake: true })).toBe(false)
    const agentTask = scheduledTaskRunKey('run-1', 'session-agent')
    expect(isPersonStartedRun({ callerId: 'local-user', idempotencyKey: agentTask })).toBe(false)
  })
})
