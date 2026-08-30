import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import { SessionWaitService } from '../../ports/session-wait-service'
import { installSessionHostEventRuntime } from '../../session-host/session-host-events'
import { SessionHostEventHub } from '../session-host-event-hub'
import { SessionHostLiveness } from '../session-host-liveness'
import { SessionWaitServiceLive } from '../session-wait-service'

describe('Session wait service', () => {
  let eventHub: SessionHostEventHub
  let liveness: SessionHostLiveness
  let releaseRuntime: () => void
  const states = new Map<
    string,
    { stateRevision: number; activeRunId: string | null; pendingFollowUpCount: number }
  >()
  const exportStatuses = new Map<string, 'queued' | 'running' | 'completed'>()

  beforeEach(() => {
    states.clear()
    exportStatuses.clear()
    eventHub = new SessionHostEventHub({ hostInstanceId: 'host-wait' })
    liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    releaseRuntime = installSessionHostEventRuntime({ eventHub, liveness })
  })

  afterEach(() => {
    releaseRuntime()
    eventHub.close()
    liveness.close()
  })

  function layer() {
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
    return SessionWaitServiceLive.pipe(Layer.provide(repository))
  }

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
      }).pipe(Effect.provide(layer())),
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
      }).pipe(Effect.provide(layer())),
    )
  }

  it('returns immediately when a requested condition already matches', async () => {
    states.set('worker', { stateRevision: 3, activeRunId: null, pendingFollowUpCount: 0 })

    await expect(waitForIdle('worker', 1_000)).resolves.toMatchObject({
      outcome: { operation: 'wait', timedOut: false, matchedSessionIds: ['worker'] },
    })
    expect(liveness.ownerCount('wait')).toBe(0)
  })

  it('subscribes once and wakes when the first target reaches the condition', async () => {
    states.set('worker', { stateRevision: 1, activeRunId: 'run-worker', pendingFollowUpCount: 0 })
    const waiting = waitForIdle('worker', 1_000)
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(liveness.ownerCount('wait')).toBe(1)
    states.set('worker', { stateRevision: 2, activeRunId: null, pendingFollowUpCount: 0 })
    eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'worker',
      stateRevision: 2,
      operation: 'run-settled',
    })

    await expect(waiting).resolves.toMatchObject({
      outcome: { timedOut: false, matchedSessionIds: ['worker'] },
    })
    expect(eventHub.subscriberCount()).toBe(0)
    expect(liveness.ownerCount('wait')).toBe(0)
  })

  it('does not let unrelated Session events exhaust a bounded wait subscription', async () => {
    states.set('worker', { stateRevision: 1, activeRunId: 'run-worker', pendingFollowUpCount: 0 })
    const waiting = waitForIdle('worker', 1_000)
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    for (let stateRevision = 1; stateRevision <= 300; stateRevision += 1) {
      eventHub.publish({
        kind: 'session-state-changed',
        sessionId: 'unrelated',
        stateRevision,
        operation: 'message',
      })
    }
    expect(eventHub.subscriberCount()).toBe(1)
    states.set('worker', { stateRevision: 2, activeRunId: null, pendingFollowUpCount: 0 })
    eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'worker',
      stateRevision: 2,
      operation: 'run-settled',
    })

    await expect(waiting).resolves.toMatchObject({
      outcome: { timedOut: false, matchedSessionIds: ['worker'] },
    })
  })

  it('revalidates Session wait authority before returning an event observation', async () => {
    states.set('worker', { stateRevision: 1, activeRunId: 'run-worker', pendingFollowUpCount: 0 })
    let observationCount = 0
    const waiting = waitForIdle('worker', 1_000, async () => {
      observationCount += 1
      if (observationCount > 1) throw new Error('profile_revoked')
      return undefined
    })
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    states.set('worker', { stateRevision: 2, activeRunId: null, pendingFollowUpCount: 0 })
    eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'worker',
      stateRevision: 2,
      operation: 'run-settled',
    })

    await expect(waiting).rejects.toThrow('profile_revoked')
    expect(observationCount).toBe(2)
    expect(eventHub.subscriberCount()).toBe(0)
    expect(liveness.ownerCount('wait')).toBe(0)
  })

  it('returns compact current state on bounded timeout', async () => {
    states.set('worker', { stateRevision: 1, activeRunId: 'run-worker', pendingFollowUpCount: 0 })

    await expect(waitForIdle('worker', 5)).resolves.toMatchObject({
      outcome: {
        timedOut: true,
        matchedSessionIds: [],
        states: [{ sessionId: 'worker', activeRunId: 'run-worker' }],
      },
    })
  })

  it('closes a Session wait subscription immediately when the calling Run is aborted', async () => {
    states.set('worker', { stateRevision: 1, activeRunId: 'run-worker', pendingFollowUpCount: 0 })
    const controller = new AbortController()
    const waiting = waitForIdle('worker', 60_000, undefined, controller.signal)
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }

    controller.abort(new Error('run replaced'))

    await expect(waiting).rejects.toThrow('run replaced')
    expect(eventHub.subscriberCount()).toBe(0)
    expect(liveness.ownerCount('wait')).toBe(0)
  })

  it('subscribes to one export operation and returns its terminal progress', async () => {
    exportStatuses.set('export-1', 'running')
    const waiting = waitForExport('worker', 'export-1', 1_000)
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    exportStatuses.set('export-1', 'completed')
    eventHub.publish({
      kind: 'session-export-changed',
      sessionId: 'worker',
      exportOperationId: 'export-1',
      status: 'completed',
      progress: { recordsWritten: 2, resourcesWritten: 0, bytesWritten: 200 },
    })

    await expect(waiting).resolves.toMatchObject({
      outcome: {
        operation: 'exports-wait',
        timedOut: false,
        export: { exportOperationId: 'export-1', status: 'completed' },
      },
    })
    expect(eventHub.subscriberCount()).toBe(0)
    expect(liveness.ownerCount('wait')).toBe(0)
  })

  it('does not let unrelated exports exhaust a bounded export wait subscription', async () => {
    exportStatuses.set('export-1', 'running')
    const waiting = waitForExport('worker', 'export-1', 1_000)
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    for (let index = 1; index <= 300; index += 1) {
      eventHub.publish({
        kind: 'session-export-changed',
        sessionId: 'unrelated',
        exportOperationId: `export-${index + 1}`,
        status: 'running',
        progress: { recordsWritten: index, resourcesWritten: 0, bytesWritten: index },
      })
    }
    expect(eventHub.subscriberCount()).toBe(1)
    exportStatuses.set('export-1', 'completed')
    eventHub.publish({
      kind: 'session-export-changed',
      sessionId: 'worker',
      exportOperationId: 'export-1',
      status: 'completed',
      progress: { recordsWritten: 2, resourcesWritten: 0, bytesWritten: 200 },
    })

    await expect(waiting).resolves.toMatchObject({
      outcome: {
        operation: 'exports-wait',
        timedOut: false,
        export: { exportOperationId: 'export-1', status: 'completed' },
      },
    })
  })

  it('revalidates export wait authority before returning terminal progress', async () => {
    exportStatuses.set('export-1', 'running')
    let observationCount = 0
    const waiting = waitForExport('worker', 'export-1', 1_000, async () => {
      observationCount += 1
      if (observationCount > 1) throw new Error('target_scope_denied')
      return undefined
    })
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    exportStatuses.set('export-1', 'completed')
    eventHub.publish({
      kind: 'session-export-changed',
      sessionId: 'worker',
      exportOperationId: 'export-1',
      status: 'completed',
      progress: { recordsWritten: 2, resourcesWritten: 0, bytesWritten: 200 },
    })

    await expect(waiting).rejects.toThrow('target_scope_denied')
    expect(observationCount).toBe(2)
    expect(eventHub.subscriberCount()).toBe(0)
    expect(liveness.ownerCount('wait')).toBe(0)
  })

  it('closes an export wait subscription immediately when the calling Run is aborted', async () => {
    exportStatuses.set('export-1', 'running')
    const controller = new AbortController()
    const waiting = waitForExport('worker', 'export-1', 60_000, undefined, controller.signal)
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }

    controller.abort(new Error('run interrupted'))

    await expect(waiting).rejects.toThrow('run interrupted')
    expect(eventHub.subscriberCount()).toBe(0)
    expect(liveness.ownerCount('wait')).toBe(0)
  })
})
