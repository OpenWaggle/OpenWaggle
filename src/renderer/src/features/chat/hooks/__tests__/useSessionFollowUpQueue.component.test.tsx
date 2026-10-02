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
      attentionReason: 'authority_changed',
      wagglePresetName: 'Cross-check',
      waggleSource: 'agent',
    })
    // A queued message shows no thinking level or access of its own: those are Session settings.
    expect(result.current.snapshot.items[0]).not.toHaveProperty('thinkingLevel')
    expect(result.current.snapshot.items[0]).not.toHaveProperty('authorizationMode')

    await act(() => result.current.enqueue(PAYLOAD))
    expect(apiMocks.mutateSessionControl).toHaveBeenCalledWith(
      expect.objectContaining({
        contractVersion: 2,
        command: {
          operation: 'follow-up',
          sessionId: SESSION_ID,
          input: {
            text: 'Run the tests',
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
})
