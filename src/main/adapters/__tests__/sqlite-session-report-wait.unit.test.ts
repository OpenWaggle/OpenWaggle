import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import { SessionReportRepository } from '../../ports/session-report-repository'
import {
  makeSessionLifecycleTestLayer,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

describe('SQLite Session report wait observations', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-report-wait-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('observes canonical per-target delivery and correlated reply transitions', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'wait-observations.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const reports = yield* SessionReportRepository
        yield* lifecycle.execute(spawnLifecycleInput())
        const original = yield* reports.execute({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-original',
            idempotencyKey: 'original',
            command: {
              operation: 'report' as const,
              sessionId: 'session-worker',
              target: { type: 'upstream' as const },
              input: { text: 'Please reply.', requestReply: true },
            },
          },
          reportId: 'report-original',
          correlationId: 'correlation-original',
          now: 3000,
        })
        const beforeDelivery = yield* reports.observeWaitCondition({
          target: {
            sessionId: 'session-parent',
            condition: 'report-delivered',
            reportId: 'report-original',
          },
        })
        yield* reports.markDelivered({
          reportIds: ['report-original'],
          targetSessionId: 'session-parent',
          runId: 'run-parent',
          itemIds: ['peer-report:run-parent:report-original'],
          deliveredAt: 3500,
        })
        const afterDelivery = yield* reports.observeWaitCondition({
          target: {
            sessionId: 'session-parent',
            condition: 'report-delivered',
            reportId: 'report-original',
          },
        })
        const beforeReply = yield* reports.observeWaitCondition({
          target: {
            sessionId: 'session-worker',
            condition: 'correlated-reply',
            correlationId: 'correlation-original',
          },
        })
        yield* reports.execute({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-reply',
            idempotencyKey: 'reply',
            command: {
              operation: 'report' as const,
              sessionId: 'session-parent',
              target: { type: 'session' as const, sessionId: 'session-worker' },
              input: {
                text: 'Here is the reply.',
                requestReply: false,
                replyToReportId: 'report-original',
              },
            },
          },
          reportId: 'report-reply',
          correlationId: 'correlation-ignored-for-reply',
          now: 4000,
        })
        const afterReply = yield* reports.observeWaitCondition({
          target: {
            sessionId: 'session-worker',
            condition: 'correlated-reply',
            correlationId: 'correlation-original',
          },
        })
        const wrongTarget = yield* reports.observeWaitCondition({
          target: {
            sessionId: 'session-parent',
            condition: 'correlated-reply',
            correlationId: 'correlation-original',
          },
        })
        return { original, beforeDelivery, afterDelivery, beforeReply, afterReply, wrongTarget }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.original.outcome).toMatchObject({ correlationId: 'correlation-original' })
    expect(result.beforeDelivery).toMatchObject({ deliveryStatus: 'pending' })
    expect(result.afterDelivery).toEqual({
      condition: 'report-delivered',
      reportId: 'report-original',
      deliveryStatus: 'delivered',
      deliveredRunId: 'run-parent',
      deliveredAt: 3500,
    })
    expect(result.beforeReply).toEqual({
      condition: 'correlated-reply',
      correlationId: 'correlation-original',
    })
    expect(result.afterReply).toEqual({
      condition: 'correlated-reply',
      correlationId: 'correlation-original',
      replyReportId: 'report-reply',
      replyToReportId: 'report-original',
      sourceSessionId: 'session-parent',
      createdAt: 4000,
    })
    expect(result.wrongTarget).toEqual({
      condition: 'correlated-reply',
      correlationId: 'correlation-original',
    })
  })
})
