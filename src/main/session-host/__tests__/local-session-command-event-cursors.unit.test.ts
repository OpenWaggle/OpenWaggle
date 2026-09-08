import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import type { SessionExportOperationSummary } from '@shared/types/session-export-operation'
import type { SessionHostEventCursor } from '@shared/types/session-host-event'
import { describe, expect, it, vi } from 'vitest'
import {
  exposeLocalSessionCommandResultCursor,
  resolveLocalSessionCommandCursor,
} from '../local-session-command-event-cursors'

const externalCursor = { hostInstanceId: 'opaque-authority.cursor', sequence: 0 }
const internalCursor = { hostInstanceId: 'host-internal', sequence: 42 }
const rotatedCursor = { hostInstanceId: 'opaque-authority.rotated', sequence: 0 }

function waitPayload(
  operation: 'wait' | 'exports-wait',
  after: SessionHostEventCursor,
): LocalSessionCommandPayload {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: 2,
      requestId: `request-${operation}`,
      query:
        operation === 'wait'
          ? {
              operation,
              targets: [{ sessionId: 'worker', condition: 'idle' }],
              timeoutMs: 100,
              after,
            }
          : {
              operation,
              sessionId: 'worker',
              exportOperationId: 'export-1',
              timeoutMs: 100,
              after,
            },
    },
  }
}

function exportSummary(): SessionExportOperationSummary {
  return {
    exportOperationId: 'export-1',
    sessionId: 'worker',
    format: 'jsonl',
    destinationPath: '/exports/worker.jsonl',
    status: 'completed',
    branchScope: 'active-branch',
    includeQueueBodies: false,
    resources: [],
    progress: { recordsWritten: 1, resourcesWritten: 0, bytesWritten: 100 },
    createdAt: 1,
    updatedAt: 2,
    completedAt: 2,
  }
}

function waitResult(operation: 'wait' | 'exports-wait'): LocalSessionCommandResult {
  return {
    contract: 'session-query-v2',
    response: {
      contractVersion: 2,
      requestId: `request-${operation}`,
      outcome:
        operation === 'wait'
          ? {
              operation,
              timedOut: false,
              matchedSessionIds: ['worker'],
              cursor: internalCursor,
              states: [],
            }
          : {
              operation,
              timedOut: false,
              cursor: internalCursor,
              export: exportSummary(),
            },
    },
  }
}

describe('Local Session command event cursors', () => {
  it.each(['wait', 'exports-wait'] as const)(
    'resolves an opaque %s cursor before application dispatch',
    (operation) => {
      const resolve = vi.fn(() => ({ status: 'ready' as const, cursor: internalCursor }))

      const resolution = resolveLocalSessionCommandCursor(
        waitPayload(operation, externalCursor),
        resolve,
      )

      expect(resolve).toHaveBeenCalledWith(externalCursor)
      expect(resolution).toMatchObject({
        status: 'ready',
        payload: { request: { query: { operation, after: internalCursor } } },
      })
    },
  )

  it('returns a typed resync outcome without forwarding a rejected cursor', () => {
    const resolution = resolveLocalSessionCommandCursor(
      waitPayload('wait', externalCursor),
      () => ({
        status: 'resync-required',
        reason: 'cursor-expired',
        cursor: rotatedCursor,
      }),
    )

    expect(resolution).toEqual({
      status: 'resync-required',
      result: {
        contract: 'session-query-v2',
        response: {
          contractVersion: 2,
          requestId: 'request-wait',
          outcome: {
            operation: 'wait',
            error: {
              code: 'resync_required',
              message: 'Session event resynchronization is required: cursor-expired.',
            },
          },
        },
      },
    })
  })

  it.each(['wait', 'exports-wait'] as const)('exposes an opaque %s outcome cursor', (operation) => {
    const expose = vi.fn(() => rotatedCursor)

    const result = exposeLocalSessionCommandResultCursor(waitResult(operation), expose)

    expect(expose).toHaveBeenCalledWith(internalCursor)
    expect(result).toMatchObject({
      response: { outcome: { operation, cursor: rotatedCursor } },
    })
  })

  it('leaves unrelated query outcomes unchanged', () => {
    const result = {
      contract: 'session-query-v2',
      response: {
        contractVersion: 2,
        requestId: 'request-status',
        outcome: {
          operation: 'status',
          sessionId: 'worker',
          stateRevision: 1,
          queueState: 'running',
          queueRevision: 1,
          activeRunId: null,
          pendingFollowUpCount: 0,
        },
      },
    } satisfies LocalSessionCommandResult
    const expose = vi.fn(() => rotatedCursor)

    expect(exposeLocalSessionCommandResultCursor(result, expose)).toBe(result)
    expect(expose).not.toHaveBeenCalled()
  })
})
