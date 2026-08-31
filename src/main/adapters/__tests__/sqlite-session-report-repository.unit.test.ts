import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import { SessionReportRepository } from '../../ports/session-report-repository'
import {
  makeSessionLifecycleTestLayer,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

describe('SQLite Session report repository', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-report-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('atomically stores an upstream report and one pending delivery', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'report.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const reports = yield* SessionReportRepository
        const sql = yield* SqlClient.SqlClient
        yield* lifecycle.execute(spawnLifecycleInput())
        const request = {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'request-report',
          idempotencyKey: 'idempotency-report',
          command: {
            operation: 'report' as const,
            sessionId: 'session-worker',
            sourceRunId: 'run-worker',
            target: { type: 'upstream' as const },
            input: {
              text: 'The verifier and regression tests are ready.',
              requestReply: true,
            },
          },
        }
        const response = yield* reports.execute({
          callerId: 'session-agent:session-worker:run-worker',
          request,
          reportId: 'report-worker-ready',
          correlationId: 'correlation-verifier',
          now: 3000,
        })
        const pending = yield* reports.listPending({ targetSessionId: 'session-parent' })
        const rows = yield* sql<{ status: string }>`
          SELECT status FROM cross_session_report_deliveries
          WHERE report_id = ${'report-worker-ready'}
        `
        return { response, pending, rows }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response).toMatchObject({
      replayed: false,
      outcome: {
        operation: 'report',
        effect: 'accepted-report',
        reportId: 'report-worker-ready',
        correlationId: 'correlation-verifier',
        targetSessionIds: ['session-parent'],
      },
    })
    expect(result.pending).toEqual([
      {
        reportId: 'report-worker-ready',
        correlationId: 'correlation-verifier',
        sourceSessionId: 'session-worker',
        sourceRunId: 'run-worker',
        authoredBy: 'session-agent:session-worker:run-worker',
        content: 'The verifier and regression tests are ready.',
        requestReply: true,
        createdAt: 3000,
      },
    ])
    expect(result.rows).toEqual([{ status: 'pending' }])
  })

  it('replays the same report idempotently without duplicating deliveries', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'replay.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const reports = yield* SessionReportRepository
        const sql = yield* SqlClient.SqlClient
        yield* lifecycle.execute(spawnLifecycleInput())
        const input = {
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-report',
            idempotencyKey: 'same-report',
            command: {
              operation: 'report' as const,
              sessionId: 'session-worker',
              target: { type: 'upstream' as const },
              input: { text: 'Ready.', requestReply: false },
            },
          },
          reportId: 'report-first',
          correlationId: 'correlation-first',
          now: 3000,
        }
        yield* reports.execute(input)
        const replay = yield* reports.execute({
          ...input,
          reportId: 'report-ignored',
          correlationId: 'correlation-ignored',
          now: 4000,
        })
        const rows = yield* sql<{ count: number }>`
          SELECT COUNT(*) AS count FROM cross_session_reports
        `
        return { replay, count: rows[0]?.count }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.replay.replayed).toBe(true)
    expect(result.replay.outcome).toMatchObject({ reportId: 'report-first' })
    expect(result.count).toBe(1)
  })

  it('rejects a source Run that does not belong to the source Session', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'wrong-source-run.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const reports = yield* SessionReportRepository
        yield* lifecycle.execute(spawnLifecycleInput())
        return yield* reports.execute({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-wrong-source-run',
            idempotencyKey: 'wrong-source-run',
            command: {
              operation: 'report' as const,
              sessionId: 'session-worker',
              sourceRunId: 'run-parent',
              target: { type: 'upstream' as const },
              input: { text: 'Forged attribution.', requestReply: false },
            },
          },
          reportId: 'report-wrong-source-run',
          correlationId: 'correlation-wrong-source-run',
          now: 3000,
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(result.outcome).toMatchObject({
      operation: 'report',
      effect: 'rejected',
      code: 'source_run_not_authorized',
    })
  })

  it('rejects a Session agent that attributes a report to a different Run', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'wrong-caller-run.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const reports = yield* SessionReportRepository
        yield* lifecycle.execute(spawnLifecycleInput())
        return yield* reports.execute({
          callerId: 'session-agent:session-worker:run-other',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-wrong-caller-run',
            idempotencyKey: 'wrong-caller-run',
            command: {
              operation: 'report' as const,
              sessionId: 'session-worker',
              sourceRunId: 'run-worker',
              target: { type: 'upstream' as const },
              input: { text: 'Forged caller attribution.', requestReply: false },
            },
          },
          reportId: 'report-wrong-caller-run',
          correlationId: 'correlation-wrong-caller-run',
          now: 3000,
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(result.outcome).toMatchObject({
      operation: 'report',
      effect: 'rejected',
      code: 'source_run_not_authorized',
    })
  })

  it('rejects an external profile that claims a real Session Run attribution', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'external-run-forgery.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const reports = yield* SessionReportRepository
        yield* lifecycle.execute(spawnLifecycleInput())
        return yield* reports.execute({
          callerId: 'profile:automation',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-external-run-forgery',
            idempotencyKey: 'external-run-forgery',
            command: {
              operation: 'report' as const,
              sessionId: 'session-worker',
              sourceRunId: 'run-worker',
              target: { type: 'upstream' as const },
              input: { text: 'Forged Worker attribution.', requestReply: false },
            },
          },
          reportId: 'report-external-run-forgery',
          correlationId: 'correlation-external-run-forgery',
          now: 3000,
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(result.outcome).toMatchObject({
      operation: 'report',
      effect: 'rejected',
      code: 'source_run_not_authorized',
    })
  })
})
