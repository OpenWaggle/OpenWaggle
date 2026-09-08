import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHookWithQueryClient } from '@/test-utils/query-test-utils'
import { useSessionFollowUpQueue } from '../useSessionFollowUpQueue'
import { PAYLOAD, queueResponse, SESSION_ID } from './session-follow-up-queue.test-fixtures'

const apiMocks = vi.hoisted(() => ({
  querySessionControl: vi.fn(),
  mutateSessionControl: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

describe('useSessionFollowUpQueue', () => {
  beforeEach(() => {
    apiMocks.querySessionControl.mockReset().mockResolvedValue(queueResponse())
    apiMocks.mutateSessionControl.mockReset().mockImplementation(async (request) => ({
      contractVersion: 2,
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      replayed: false,
      outcome: {
        operation: request.command.operation,
        effect: request.command.operation === 'promote' ? 'promoted-follow-up' : 'queued-follow-up',
        sessionId: SESSION_ID,
        runId: 'run-1',
        followUpId: 'follow-up-1',
        queueRevision: 5,
        stateRevision: 6,
        receipt: { delivery: 'queued', durableTextSha256: 'a'.repeat(64), minimumCreatedOrder: 1 },
      },
    }))
  })

  it('projects durable queue bodies and submits new Follow-ups by attachment identity', async () => {
    const { result } = renderHookWithQueryClient(() => useSessionFollowUpQueue(SESSION_ID))
    await waitFor(() => expect(result.current.snapshot.items).toHaveLength(1))
    expect(result.current.snapshot.items[0]).toMatchObject({
      id: 'follow-up-1',
      text: 'Existing follow-up',
      deliveryState: 'needs_attention',
      attentionReason: 'authorization_ceiling_changed',
      authorizationMode: 'yolo',
      wagglePresetName: 'Cross-check',
      waggleSource: 'agent',
    })

    await act(() => result.current.enqueue(PAYLOAD))
    expect(apiMocks.mutateSessionControl).toHaveBeenCalledWith(
      expect.objectContaining({
        contractVersion: 2,
        command: {
          operation: 'follow-up',
          sessionId: SESSION_ID,
          input: {
            text: 'Run the tests',
            thinkingLevel: 'high',
            attachmentIds: ['attachment-1'],
          },
        },
      }),
    )
  })

  it('promotes one durable Follow-up into the exact active Run', async () => {
    const { result } = renderHookWithQueryClient(() => useSessionFollowUpQueue(SESSION_ID))
    await waitFor(() => expect(result.current.snapshot.activeRunId).toBe('run-1'))

    await act(async () => {
      expect(await result.current.promote('follow-up-1')).toEqual({
        delivery: 'queued',
        durableTextSha256: 'a'.repeat(64),
        minimumCreatedOrder: 1,
      })
    })
    expect(apiMocks.mutateSessionControl).toHaveBeenCalledWith(
      expect.objectContaining({
        command: {
          operation: 'promote',
          sessionId: SESSION_ID,
          expectedRunId: 'run-1',
          followUpId: 'follow-up-1',
        },
      }),
    )
  })

  it('re-submits a blocked Follow-up under current inherited authorization', async () => {
    apiMocks.mutateSessionControl.mockImplementation(async (request) => ({
      contractVersion: 2,
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      replayed: false,
      outcome:
        request.command.operation === 'queue-update-authorization'
          ? {
              operation: 'queue-update-authorization',
              effect: 'queue-updated',
              sessionId: SESSION_ID,
              queueState: 'paused',
              queueRevision: 5,
              followUpIds: ['follow-up-1'],
              stateRevision: 6,
            }
          : {
              operation: 'queue-resume',
              effect: 'queue-updated',
              sessionId: SESSION_ID,
              queueState: 'running',
              queueRevision: 6,
              followUpIds: ['follow-up-1'],
              stateRevision: 7,
            },
    }))
    const { result } = renderHookWithQueryClient(() => useSessionFollowUpQueue(SESSION_ID))
    await waitFor(() => expect(result.current.snapshot.items).toHaveLength(1))

    await act(() => result.current.resubmitWithCurrentAccess('follow-up-1'))
    expect(apiMocks.mutateSessionControl).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: {
          operation: 'queue-update-authorization',
          sessionId: SESSION_ID,
          followUpId: 'follow-up-1',
          runAuthorizationOverride: null,
        },
      }),
    )
    expect(apiMocks.mutateSessionControl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        command: {
          operation: 'queue-resume',
          sessionId: SESSION_ID,
          expectedQueueRevision: 5,
        },
      }),
    )
  })

  it('revision-safely recovers a running idle attention head before resuming it', async () => {
    const idleQueue = {
      ...queueResponse(),
      outcome: { ...queueResponse().outcome, activeRunId: null },
    }
    apiMocks.querySessionControl.mockResolvedValueOnce(idleQueue).mockResolvedValue({
      ...idleQueue,
      outcome: { ...idleQueue.outcome, queueRevision: 5 },
    })
    apiMocks.mutateSessionControl.mockImplementation(async (request) => ({
      contractVersion: 2,
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      replayed: false,
      outcome:
        request.command.operation === 'queue-update-authorization'
          ? {
              operation: 'queue-update-authorization',
              effect: 'queue-updated',
              sessionId: SESSION_ID,
              queueState: 'running',
              queueRevision: 5,
              followUpIds: ['follow-up-1'],
              stateRevision: 6,
            }
          : request.command.operation === 'queue-pause'
            ? {
                operation: 'queue-pause',
                effect: 'queue-updated',
                sessionId: SESSION_ID,
                queueState: 'paused',
                queueRevision: 6,
                followUpIds: ['follow-up-1'],
                stateRevision: 7,
              }
            : {
                operation: 'queue-resume',
                effect: 'started-run',
                sessionId: SESSION_ID,
                runId: 'run-recovered',
                followUpId: 'follow-up-1',
                queueRevision: 8,
                stateRevision: 8,
              },
    }))
    const { result } = renderHookWithQueryClient(() => useSessionFollowUpQueue(SESSION_ID))
    await waitFor(() => expect(result.current.snapshot.activeRunId).toBeNull())

    await act(() => result.current.resubmitWithCurrentAccess('follow-up-1'))

    expect(apiMocks.mutateSessionControl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        command: {
          operation: 'queue-pause',
          sessionId: SESSION_ID,
          expectedQueueRevision: 5,
        },
      }),
    )
    expect(apiMocks.mutateSessionControl).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        command: {
          operation: 'queue-resume',
          sessionId: SESSION_ID,
          expectedQueueRevision: 6,
        },
      }),
    )
  })

  it('re-reads a stale active Run before recovering a repaired running queue', async () => {
    const idleQueue = {
      ...queueResponse(),
      outcome: {
        ...queueResponse().outcome,
        queueRevision: 5,
        activeRunId: null,
      },
    }
    apiMocks.querySessionControl.mockResolvedValueOnce(queueResponse()).mockResolvedValue(idleQueue)
    apiMocks.mutateSessionControl.mockImplementation(async (request) => ({
      contractVersion: 2,
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      replayed: false,
      outcome:
        request.command.operation === 'queue-update-authorization'
          ? {
              operation: 'queue-update-authorization',
              effect: 'queue-updated',
              sessionId: SESSION_ID,
              queueState: 'running',
              queueRevision: 5,
              followUpIds: ['follow-up-1'],
              stateRevision: 6,
            }
          : request.command.operation === 'queue-pause'
            ? {
                operation: 'queue-pause',
                effect: 'queue-updated',
                sessionId: SESSION_ID,
                queueState: 'paused',
                queueRevision: 6,
                followUpIds: ['follow-up-1'],
                stateRevision: 7,
              }
            : {
                operation: 'queue-resume',
                effect: 'started-run',
                sessionId: SESSION_ID,
                runId: 'run-recovered',
                followUpId: 'follow-up-1',
                queueRevision: 8,
                stateRevision: 8,
              },
    }))
    const { result } = renderHookWithQueryClient(() => useSessionFollowUpQueue(SESSION_ID))
    await waitFor(() => expect(result.current.snapshot.activeRunId).toBe('run-1'))

    await act(() => result.current.resubmitWithCurrentAccess('follow-up-1'))

    expect(apiMocks.querySessionControl).toHaveBeenCalledTimes(3)
    const commands = apiMocks.mutateSessionControl.mock.calls.map(([request]) => request.command)
    expect(commands.map((command) => command.operation)).toEqual([
      'queue-update-authorization',
      'queue-pause',
      'queue-resume',
    ])
    expect(commands[1]).toMatchObject({ sessionId: SESSION_ID, expectedQueueRevision: 5 })
    expect(commands[2]).toMatchObject({ sessionId: SESSION_ID, expectedQueueRevision: 6 })
  })
})
