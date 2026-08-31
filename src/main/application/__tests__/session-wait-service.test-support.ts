import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { vi } from 'vitest'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import { SessionWaitService } from '../../ports/session-wait-service'
import { installSessionHostEventRuntime } from '../../session-host/session-host-events'
import { SessionHostEventHub } from '../session-host-event-hub'
import { SessionHostLiveness } from '../session-host-liveness'
import { SessionWaitServiceLive } from '../session-wait-service'

type SessionState = {
  readonly stateRevision: number
  readonly activeRunId: string | null
  readonly pendingFollowUpCount: number
}

export function createSessionWaitTestHarness() {
  const states = new Map<string, SessionState>()
  const exportStatuses = new Map<string, 'queued' | 'running' | 'completed'>()
  const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-wait' })
  const liveness = new SessionHostLiveness({
    idleGracePeriodMs: 60_000,
    requestShutdown: vi.fn(),
  })
  const releaseRuntime = installSessionHostEventRuntime({ eventHub, liveness })
  const repository = Layer.succeed(SessionQueryRepository, {
    execute: ({ request }) => {
      if (request.query.operation === 'exports-read') {
        const status = exportStatuses.get(request.query.exportOperationId)
        return Effect.succeed({
          contractVersion: 2 as const,
          requestId: request.requestId,
          outcome: status
            ? {
                operation: 'exports-read' as const,
                export: {
                  exportOperationId: request.query.exportOperationId,
                  sessionId: request.query.sessionId,
                  format: 'jsonl' as const,
                  destinationPath: '/tmp/export.jsonl',
                  status,
                  branchScope: 'tree' as const,
                  includeQueueBodies: false,
                  resources: [],
                  progress: {
                    recordsWritten: status === 'completed' ? 2 : 1,
                    resourcesWritten: 0,
                    bytesWritten: status === 'completed' ? 200 : 100,
                  },
                  createdAt: 1,
                  updatedAt: status === 'completed' ? 3 : 2,
                },
              }
            : {
                operation: 'exports-read' as const,
                error: { code: 'export_not_found' as const, message: 'missing' },
              },
        })
      }
      if (request.query.operation !== 'status') throw new Error('Expected status query.')
      const state = states.get(request.query.sessionId)
      return Effect.succeed({
        contractVersion: 2 as const,
        requestId: request.requestId,
        outcome: state
          ? {
              operation: 'status' as const,
              sessionId: request.query.sessionId,
              stateRevision: state.stateRevision,
              queueState: 'running' as const,
              queueRevision: 0,
              activeRunId: state.activeRunId,
              ...(state.activeRunId ? { activeRunStatus: 'active' } : {}),
              pendingFollowUpCount: state.pendingFollowUpCount,
            }
          : {
              operation: 'status' as const,
              error: { code: 'session_not_found' as const, message: 'missing' },
            },
      })
    },
  })
  const layer = SessionWaitServiceLive.pipe(Layer.provide(repository))

  function waitForIdle(
    sessionId: string,
    timeoutMs: number,
    resolveObservationAuthority?: () => Promise<undefined>,
    signal?: AbortSignal,
  ) {
    return Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionWaitService
        return yield* service.wait({
          ...(resolveObservationAuthority ? { resolveObservationAuthority } : {}),
          ...(signal ? { signal } : {}),
          request: {
            contractVersion: 2,
            requestId: 'wait-request',
            query: {
              operation: 'wait',
              targets: [{ sessionId, condition: 'idle' }],
              timeoutMs,
            },
          },
        })
      }).pipe(Effect.provide(layer)),
    )
  }

  function waitForExport(
    sessionId: string,
    exportOperationId: string,
    timeoutMs: number,
    resolveObservationAuthority?: () => Promise<undefined>,
    signal?: AbortSignal,
  ) {
    return Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionWaitService
        return yield* service.waitForExport({
          ...(resolveObservationAuthority ? { resolveObservationAuthority } : {}),
          ...(signal ? { signal } : {}),
          request: {
            contractVersion: 2,
            requestId: 'export-wait-request',
            query: {
              operation: 'exports-wait',
              sessionId,
              exportOperationId,
              timeoutMs,
            },
          },
        })
      }).pipe(Effect.provide(layer)),
    )
  }

  return {
    states,
    exportStatuses,
    eventHub,
    liveness,
    waitForIdle,
    waitForExport,
    close: () => {
      releaseRuntime()
      eventHub.close()
      liveness.close()
    },
  }
}

export type SessionWaitTestHarness = ReturnType<typeof createSessionWaitTestHarness>
