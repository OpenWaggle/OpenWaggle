import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { submitSessionMessage } from '../../application/session-control-service'
import { scheduledTaskRunKey } from '../../domain/scheduled-tasks/scheduled-task-run-key'
import { expiredFollowUpEditHoldKey } from '../../domain/session-control/follow-up-edit-hold-release-key'
import { isPersonStartedRun } from '../../domain/session-control/person-started-run'
import { newRunAdmissionRefusal } from '../sqlite-session-control-queue-delivery'
import { loadSessionControlState } from '../sqlite-session-control-state'
import { countActiveWorkerRuns, recordAgentMadeSession } from '../sqlite-worker-run-admission'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'
import {
  AGENT_CALLER,
  makeTargetAWorker,
  messageRequest,
  seedHive,
  targetRunCount,
} from './sqlite-worker-run-admission.test-support'

let temporaryRoot = ''

/** Records that `callerId` made `session-target` with `operation`, as the lifecycle does. */
function targetMadeBy(
  sql: SqlClient.SqlClient,
  callerId: string,
  idempotencyKey = 'idempotency-make-target',
  operation: 'create' | 'launch' | 'fork' = 'launch',
) {
  return recordAgentMadeSession(sql, {
    operation,
    sessionId: 'session-target',
    callerId,
    idempotencyKey,
    now: 1,
  })
}

/** `sessionId`'s state as if a Host-authored Hive wake were starting its next Run. */
function wakeStarting(sql: SqlClient.SqlClient, sessionId: string) {
  return runStarting(sql, sessionId, { callerId: 'gui:local-user', hiveWake: true })
}

/** `sessionId`'s state as if a Run for `caller` were starting. */
function runStarting(
  sql: SqlClient.SqlClient,
  sessionId: string,
  caller: { readonly callerId: string; readonly hiveWake?: true },
) {
  return Effect.map(loadSessionControlState(sql, sessionId), (state) => ({
    ...state,
    run: {
      state: 'starting' as const,
      runId: RunId(`run-next-${sessionId}`),
      intent: {
        text: 'A Worker reported.',
        attachmentIds: [],
        acceptedAt: 1,
        idempotencyKey: `run-key-${sessionId}`,
        ...caller,
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

  it.each(['create', 'launch', 'fork'] as const)(
    'holds a root an agent made by %s to the Worker ceiling, and counts its Run',
    async (operation) => {
      const layer = makeSessionControlTestLayer(
        path.join(temporaryRoot, `agent-${operation}.sqlite`),
      )
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* seedHive(sql, 2)
          yield* targetMadeBy(sql, 'session-agent:queen:run-queen', 'key', operation)
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
    },
  )

  it('does not count a root the person launched, from the app, the CLI or their own task', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'person-roots.sqlite'))
    const counted = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 1)
        yield* targetMadeBy(sql, 'local-user', scheduledTaskRunKey('run-1', false))
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
        yield* targetMadeBy(sql, 'local-user', scheduledTaskRunKey('run-1', true))
        yield* submitSessionMessage({
          callerId: 'gui:local-user',
          request: messageRequest('session-target', 'person'),
        })
        return yield* countActiveWorkerRuns(sql)
      }).pipe(Effect.provide(layer)),
    )

    expect(counted).toBe(2)
  })

  // A Heartbeat runs as the person, so only its key tells the agent's work from theirs.
  it.each([
    ['refuses', 'an agent’s', true, 'rejected'],
    ['starts', 'the person’s', false, 'started-run'],
  ] as const)(
    '%s %s Heartbeat in a Worker at the Worker ceiling',
    async (_, __, byAgent, effect) => {
      const layer = makeSessionControlTestLayer(
        path.join(temporaryRoot, `heartbeat-${String(byAgent)}.sqlite`),
      )
      const response = await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* seedHive(sql, 2)
          yield* makeTargetAWorker(sql)
          return yield* submitSessionMessage({
            callerId: 'local-user',
            hostRunCeiling: 2,
            request: {
              ...messageRequest('session-target', 'heartbeat'),
              idempotencyKey: scheduledTaskRunKey('run-1', byAgent),
            },
          })
        }).pipe(Effect.provide(layer)),
      )

      expect(response.outcome).toMatchObject({ effect })
    },
  )

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

  it('holds an agent’s Follow-up an expired edit hold delivers, though the person’s queue action would not be', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'expired-hold.sqlite'))
    const refusals = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 2)
        yield* makeTargetAWorker(sql)
        const agentNext = yield* runStarting(sql, 'session-target', { callerId: AGENT_CALLER })
        const cancel = { callerId: 'gui:local-user', operation: 'queue-edit-cancel' } as const
        return {
          byPerson: yield* newRunAdmissionRefusal(sql, agentNext, 2, {
            ...cancel,
            idempotencyKey: 'person-cancel',
          }),
          byExpiry: yield* newRunAdmissionRefusal(sql, agentNext, 2, {
            ...cancel,
            idempotencyKey: expiredFollowUpEditHoldKey('hold-1'),
          }),
        }
      }).pipe(Effect.provide(layer)),
    )

    expect(refusals).toEqual({ byPerson: undefined, byExpiry: 'host_run_ceiling_reached' })
  })
})

describe('isPersonStartedRun', () => {
  it('is the person from the app, the CLI, another local-user client or their own task', () => {
    expect(isPersonStartedRun({ callerId: 'gui:local-user' })).toBe(true)
    expect(isPersonStartedRun({ callerId: 'local-user' })).toBe(true)
    expect(isPersonStartedRun({ callerId: 'local-user:machine' })).toBe(true)
    const ownTask = scheduledTaskRunKey('run-1', false)
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
    const agentTask = scheduledTaskRunKey('run-1', true)
    expect(isPersonStartedRun({ callerId: 'local-user', idempotencyKey: agentTask })).toBe(false)
  })
})
