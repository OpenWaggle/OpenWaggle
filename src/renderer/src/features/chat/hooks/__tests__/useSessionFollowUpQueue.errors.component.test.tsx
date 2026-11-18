import { SessionId } from '@shared/types/brand'
import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHookWithQueryClient } from '@/test-utils/query-test-utils'
import {
  FOLLOW_UP_QUEUE_READ_RETRIES,
  FOLLOW_UP_QUEUE_RECOVERY_INTERVAL_MS,
} from '../session-follow-up-queue-read-policy'
import { useSessionFollowUpQueue } from '../useSessionFollowUpQueue'

const apiMocks = vi.hoisted(() => ({
  querySessionControl: vi.fn(),
  mutateSessionControl: vi.fn(),
}))
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
    apiMocks.mutateSessionControl.mockReset()
  })

  function failQueueReads(times: number, message: string) {
    for (let attempt = 0; attempt < times; attempt += 1) {
      apiMocks.querySessionControl.mockRejectedValueOnce(new Error(message))
    }
    apiMocks.querySessionControl.mockResolvedValue(QUEUE_RESPONSE)
  }

  describe('on a clock the test drives', () => {
    /** Longer than every retry backoff together (500 ms, then 1 s). */
    const PAST_EVERY_RETRY_MS = 2_000

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    async function advance(ms: number) {
      await act(() => vi.advanceTimersByTimeAsync(ms))
    }

    it('rides out a transient read failure without reporting the queue unavailable', async () => {
      failQueueReads(FOLLOW_UP_QUEUE_READ_RETRIES, 'Timed out waiting for the Local Session Host.')
      const { result } = renderHookWithQueryClient(() => useSessionFollowUpQueue(SESSION_ID))

      await advance(PAST_EVERY_RETRY_MS)

      expect(result.current.snapshot.items[0]?.text).toBe('Recovered durable work')
      expect(result.current.error).toBeNull()
      expect(apiMocks.querySessionControl).toHaveBeenCalledTimes(FOLLOW_UP_QUEUE_READ_RETRIES + 1)
    })

    it('surfaces a persistent read failure and recovers through explicit refresh', async () => {
      failQueueReads(FOLLOW_UP_QUEUE_READ_RETRIES + 1, 'Session Host unavailable')
      const { result } = renderHookWithQueryClient(() => useSessionFollowUpQueue(SESSION_ID))

      await advance(PAST_EVERY_RETRY_MS)
      expect(result.current.error).toEqual(new Error('Session Host unavailable'))
      expect(result.current.snapshot.items).toEqual([])

      await act(() => result.current.refresh())
      await advance(0)
      expect(result.current.error).toBeNull()
      expect(result.current.snapshot.items[0]?.text).toBe('Recovered durable work')
    })

    it('keeps re-reading a failed queue until the Session Host answers', async () => {
      failQueueReads(FOLLOW_UP_QUEUE_READ_RETRIES + 1, 'Local Session Host connection closed.')
      const { result } = renderHookWithQueryClient(() => useSessionFollowUpQueue(SESSION_ID))

      await advance(PAST_EVERY_RETRY_MS)
      expect(result.current.error).not.toBeNull()

      await advance(FOLLOW_UP_QUEUE_RECOVERY_INTERVAL_MS)
      expect(result.current.error).toBeNull()
      expect(result.current.snapshot.items[0]?.text).toBe('Recovered durable work')
    })
  })

  it.each(['/compact', '/compact preserve decisions', '/fork', '/clone'])(
    'refuses to enqueue or promote the GUI command %s',
    async (text) => {
      apiMocks.querySessionControl.mockResolvedValue({
        ...QUEUE_RESPONSE,
        outcome: {
          ...QUEUE_RESPONSE.outcome,
          activeRunId: 'run-1',
          items: QUEUE_RESPONSE.outcome.items.map((item) => ({
            ...item,
            intent: { ...item.intent, text },
          })),
        },
      })
      const { result } = renderHookWithQueryClient(() => useSessionFollowUpQueue(SESSION_ID))
      await waitFor(() => expect(result.current.snapshot.items[0]?.text).toBe(text))

      await expect(result.current.enqueue({ text, attachments: [] })).rejects.toThrow(
        'Wait for the active Run to finish',
      )
      await expect(result.current.promote('follow-up-recovered')).rejects.toThrow(
        'This command cannot steer a Run.',
      )

      expect(apiMocks.mutateSessionControl).not.toHaveBeenCalled()
      expect(result.current.snapshot.items[0]?.text).toBe(text)
    },
  )
})
