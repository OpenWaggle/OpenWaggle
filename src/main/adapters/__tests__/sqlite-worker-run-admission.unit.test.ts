import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  queueSessionFollowUp,
  submitSessionMessage,
} from '../../application/session-control-service'
import { countActiveWorkerRuns } from '../sqlite-worker-run-admission'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'
import {
  AGENT_CALLER,
  makeTargetAWorker,
  messageRequest,
  seedActiveSessions,
  seedHive,
  targetRunCount,
} from './sqlite-worker-run-admission.test-support'

let temporaryRoot = ''

describe('Worker Run admission', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-worker-admission-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('starts the person’s message in a root Session while every Worker slot is taken', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'person-root.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 16)
        const fromApp = yield* submitSessionMessage({
          callerId: 'gui:local-user',
          hostRunCeiling: 16,
          request: messageRequest('session-target', 'app'),
        })
        return { fromApp, runs: yield* targetRunCount(sql) }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.fromApp.outcome).toMatchObject({ effect: 'started-run' })
    expect(result.runs).toBe(1)
  })

  it('starts the person’s Follow-up in a root Session while every Worker slot is taken', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'person-follow-up.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 2)
        return yield* queueSessionFollowUp({
          callerId: 'local-user:machine',
          hostRunCeiling: 2,
          request: {
            ...messageRequest('session-target', 'follow-up'),
            command: {
              operation: 'follow-up',
              sessionId: 'session-target',
              input: { text: 'And then this.', attachmentIds: [] },
            },
          },
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(result.outcome).toMatchObject({ operation: 'follow-up', effect: 'started-run' })
  })

  // Agents cannot fan out over the person's Sessions uncounted (ADR 0030, amended 2026-11-10).
  it('refuses an agent’s Run in a root Session the person made when the Worker ceiling is full', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'agent-root.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 3)
        const response = yield* submitSessionMessage({
          callerId: AGENT_CALLER,
          hostRunCeiling: 3,
          request: messageRequest('session-target', 'agent-root'),
        })
        return { response, runs: yield* targetRunCount(sql) }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({
      effect: 'rejected',
      code: 'host_run_ceiling_reached',
    })
    expect(result.runs).toBe(0)
  })

  it('starts an agent’s Run in a root Session the person made while a slot is free, and counts it', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'agent-root-free.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 1)
        const response = yield* submitSessionMessage({
          callerId: AGENT_CALLER,
          hostRunCeiling: 3,
          request: messageRequest('session-target', 'agent-root-free'),
        })
        return { response, activeWorkerRuns: yield* countActiveWorkerRuns(sql) }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({ effect: 'started-run' })
    // The Worker's Run and the agent's Run in the person's root; never the Queen's own.
    expect(result.activeWorkerRuns).toBe(2)
  })

  it.each([
    ['refuses an agent-written', 'scheduled-task-run:session-agent:task-run-1', 'rejected', 0],
    ['starts the person’s', 'scheduled-task-run:task-run-1', 'started-run', 1],
  ] as const)(
    '%s Heartbeat firing into the person’s root at a full Worker ceiling',
    async (_, idempotencyKey, effect, runs) => {
      const layer = makeSessionControlTestLayer(
        path.join(temporaryRoot, `heartbeat-${runs}.sqlite`),
      )
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* seedHive(sql, 2)
          const response = yield* submitSessionMessage({
            callerId: 'local-user',
            hostRunCeiling: 2,
            request: { ...messageRequest('session-target', 'heartbeat'), idempotencyKey },
          })
          return { response, runs: yield* targetRunCount(sql) }
        }).pipe(Effect.provide(layer)),
      )

      expect(result.response.outcome).toMatchObject({ effect })
      expect(result.runs).toBe(runs)
    },
  )

  it('records whose work each Run is when it starts', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'work-by-agent.sqlite'))
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 0)
        yield* submitSessionMessage({
          callerId: 'gui:local-user',
          hostRunCeiling: 16,
          request: messageRequest('session-target', 'person-first'),
        })
        return yield* sql<{ readonly workByAgent: number }>`
          SELECT work_by_agent AS workByAgent FROM session_runs WHERE session_id = ${'session-target'}
        `
      }).pipe(Effect.provide(layer)),
    )

    expect(rows).toEqual([{ workByAgent: 0 }])
  })

  it('refuses an agent’s Worker Run when the Worker ceiling is full', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'agent-worker.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 2)
        yield* makeTargetAWorker(sql)
        const response = yield* submitSessionMessage({
          callerId: AGENT_CALLER,
          hostRunCeiling: 2,
          request: messageRequest('session-target', 'agent-worker'),
        })
        return { response, runs: yield* targetRunCount(sql) }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({
      effect: 'rejected',
      code: 'host_run_ceiling_reached',
      kind: 'conflict',
    })
    expect(result.runs).toBe(0)
  })

  it('does not count root Sessions’ Runs toward the Worker ceiling', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'roots-free.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 1)
        yield* seedActiveSessions(sql, ['root-a', 'root-b', 'root-c'])
        yield* makeTargetAWorker(sql)
        const response = yield* submitSessionMessage({
          callerId: AGENT_CALLER,
          hostRunCeiling: 2,
          request: messageRequest('session-target', 'roots-free'),
        })
        return { response, activeWorkerRuns: yield* countActiveWorkerRuns(sql) }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({ effect: 'started-run' })
    expect(result.activeWorkerRuns).toBe(2)
  })

  it('starts the person’s message to a Worker at both Worker limits', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'person-worker.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHive(sql, 2)
        yield* sql`
          UPDATE settings_store SET value_json = ${'1'}
          WHERE key = ${'sessionHostParentConcurrencyLimit'}
        `
        yield* makeTargetAWorker(sql)
        return yield* submitSessionMessage({
          callerId: 'gui:local-user',
          hostRunCeiling: 2,
          request: messageRequest('session-target', 'person-worker'),
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(result.outcome).toMatchObject({ effect: 'started-run' })
  })
})
