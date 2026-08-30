import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHookWithQueryClient } from '@/test-utils/query-test-utils'
import { useSessionFollowUpQueue } from '../useSessionFollowUpQueue'

const apiMocks = vi.hoisted(() => ({
  querySessionControl: vi.fn(),
  mutateSessionControl: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

const SESSION_ID = SessionId('session-1')
const PAYLOAD: AgentSendPayload = {
  text: 'Run the tests',
  thinkingLevel: 'high',
  attachments: [
    {
      id: 'attachment-1',
      kind: 'text',
      name: 'notes.txt',
      path: '/tmp/notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 4,
      extractedText: 'test',
    },
  ],
}

function queueResponse() {
  return {
    contractVersion: 2 as const,
    requestId: 'query-1',
    outcome: {
      operation: 'queue-list' as const,
      sessionId: SESSION_ID,
      queueState: 'running' as const,
      queueRevision: 4,
      activeRunId: 'run-1',
      items: [
        {
          followUpId: 'follow-up-1',
          position: 0,
          createdAt: 10,
          deliveryState: 'needs_attention' as const,
          attentionReason: 'authorization_ceiling_changed' as const,
          intent: { text: 'Existing follow-up', attachmentIds: [] },
        },
      ],
      omittedBodyCount: 0,
    },
  }
}

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

    await act(() => result.current.promote('follow-up-1'))
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
    apiMocks.querySessionControl.mockResolvedValue({
      ...queueResponse(),
      outcome: { ...queueResponse().outcome, activeRunId: null },
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
})
