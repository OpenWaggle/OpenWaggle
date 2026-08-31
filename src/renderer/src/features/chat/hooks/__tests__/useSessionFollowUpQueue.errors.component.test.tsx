import { SessionId } from '@shared/types/brand'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHookWithQueryClient } from '@/test-utils/query-test-utils'
import { useSessionFollowUpQueue } from '../useSessionFollowUpQueue'

const apiMocks = vi.hoisted(() => ({ querySessionControl: vi.fn() }))
vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

const SESSION_ID = SessionId('session-queue-error')
const QUEUE_RESPONSE = {
  contractVersion: 2 as const,
  requestId: 'query-recovered',
  outcome: {
    operation: 'queue-list' as const,
    sessionId: SESSION_ID,
    queueState: 'running' as const,
    queueRevision: 1,
    activeRunId: null,
    items: [
      {
        followUpId: 'follow-up-recovered',
        position: 0,
        createdAt: 1,
        deliveryState: 'pending' as const,
        intent: { text: 'Recovered durable work', attachmentIds: [] },
      },
    ],
    omittedBodyCount: 0,
  },
}

describe('useSessionFollowUpQueue errors', () => {
  beforeEach(() => {
    apiMocks.querySessionControl.mockReset()
  })

  it('surfaces an initial read failure and recovers through explicit refresh', async () => {
    apiMocks.querySessionControl
      .mockRejectedValueOnce(new Error('Session Host unavailable'))
      .mockResolvedValue(QUEUE_RESPONSE)
    const { result } = renderHookWithQueryClient(() => useSessionFollowUpQueue(SESSION_ID))

    await waitFor(() => expect(result.current.error).toEqual(new Error('Session Host unavailable')))
    expect(result.current.snapshot.items).toEqual([])

    await act(() => result.current.refresh())
    await waitFor(() => expect(result.current.error).toBeNull())
    expect(result.current.snapshot.items[0]?.text).toBe('Recovered durable work')
  })
})
