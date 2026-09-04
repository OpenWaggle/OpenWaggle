import { SessionId } from '@shared/types/brand'
import type { ThinkingLevel } from '@shared/types/settings'
import { beforeEach, describe, expect, it } from 'vitest'
import { selectQueue, useMessageQueueStore } from '../message-queue-store'

const CONV_A = SessionId('session-a')
const CONV_B = SessionId('session-b')
const THINKING: ThinkingLevel = 'medium'

function makePayload(text: string) {
  return { text, thinkingLevel: THINKING, attachments: [] as const }
}

describe('message-queue-store', () => {
  beforeEach(() => {
    useMessageQueueStore.setState({ queues: new Map() })
  })

  describe('enqueue', () => {
    it('adds a message to the queue for a session', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('hello'))
      const queue = useMessageQueueStore.getState().queues.get(CONV_A)
      expect(queue).toHaveLength(1)
      expect(queue?.[0].payload.text).toBe('hello')
    })

    it('preserves FIFO order across multiple enqueues', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('first'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('second'))
      const queue = useMessageQueueStore.getState().queues.get(CONV_A)
      expect(queue).toHaveLength(2)
      expect(queue?.[0].payload.text).toBe('first')
      expect(queue?.[1].payload.text).toBe('second')
    })

    it('isolates queues per session', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('a'))
      useMessageQueueStore.getState().enqueue(CONV_B, makePayload('b'))
      expect(useMessageQueueStore.getState().queues.get(CONV_A)).toHaveLength(1)
      expect(useMessageQueueStore.getState().queues.get(CONV_B)).toHaveLength(1)
    })

    it('generates unique IDs for each queued message', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('a'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('b'))
      const queue = useMessageQueueStore.getState().queues.get(CONV_A)
      expect(queue?.[0].id).not.toBe(queue?.[1].id)
    })
  })

  describe('dequeue', () => {
    it('returns the first item and removes it from the queue', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('first'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('second'))
      const item = useMessageQueueStore.getState().dequeue(CONV_A)
      expect(item?.payload.text).toBe('first')
      expect(useMessageQueueStore.getState().queues.get(CONV_A)).toHaveLength(1)
    })

    it('returns null when the queue is empty', () => {
      const item = useMessageQueueStore.getState().dequeue(CONV_A)
      expect(item).toBeNull()
    })

    it('removes the session key when the last item is dequeued', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('only'))
      useMessageQueueStore.getState().dequeue(CONV_A)
      expect(useMessageQueueStore.getState().queues.has(CONV_A)).toBe(false)
    })
  })

  describe('dismiss', () => {
    it('removes a specific queued message by id', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('keep'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('remove'))
      const queue = useMessageQueueStore.getState().queues.get(CONV_A)
      const removeId = queue?.[1].id ?? ''
      useMessageQueueStore.getState().dismiss(CONV_A, removeId)
      const remaining = useMessageQueueStore.getState().queues.get(CONV_A)
      expect(remaining).toHaveLength(1)
      expect(remaining?.[0].payload.text).toBe('keep')
    })

    it('is a no-op when session has no queue', () => {
      useMessageQueueStore.getState().dismiss(CONV_A, 'nonexistent')
      expect(useMessageQueueStore.getState().queues.has(CONV_A)).toBe(false)
    })

    it('removes the session key when last item is dismissed', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('only'))
      const queue = useMessageQueueStore.getState().queues.get(CONV_A)
      useMessageQueueStore.getState().dismiss(CONV_A, queue?.[0].id ?? '')
      expect(useMessageQueueStore.getState().queues.has(CONV_A)).toBe(false)
    })
  })

  describe('take and restore', () => {
    it('restores a failed promoted steer at the front of the queue', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('first'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('second'))
      const original = useMessageQueueStore.getState().queues.get(CONV_A)
      const second = original?.[1]
      if (!second) throw new Error('Expected second queued message')

      useMessageQueueStore.getState().promoteToFront(CONV_A, second.id)
      const promoted = useMessageQueueStore.getState().take(CONV_A, second.id)
      if (!promoted) throw new Error('Expected promoted queue removal')
      useMessageQueueStore.getState().restore(CONV_A, promoted)

      expect(
        useMessageQueueStore
          .getState()
          .queues.get(CONV_A)
          ?.map((item) => item.payload.text),
      ).toEqual(['second', 'first'])
    })

    it('restores the exact queue item at its original position', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('first'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('second'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('third'))
      const original = useMessageQueueStore.getState().queues.get(CONV_A)
      const second = original?.[1]
      if (!second) throw new Error('Expected second queued message')

      const taken = useMessageQueueStore.getState().take(CONV_A, second.id)
      if (!taken) throw new Error('Expected queue removal')
      expect(taken).toEqual({
        item: second,
        index: 1,
        previousId: original?.[0]?.id,
        nextId: original?.[2]?.id,
      })
      useMessageQueueStore.getState().restore(CONV_A, taken)

      expect(useMessageQueueStore.getState().queues.get(CONV_A)).toEqual(original)
    })

    it('uses surviving neighbors when concurrent removals make the numeric index stale', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('first'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('second'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('third'))
      const original = useMessageQueueStore.getState().queues.get(CONV_A)
      const first = original?.[0]
      const second = original?.[1]
      if (!first || !second) throw new Error('Expected queued messages')

      const takenSecond = useMessageQueueStore.getState().take(CONV_A, second.id)
      useMessageQueueStore.getState().take(CONV_A, first.id)
      if (!takenSecond) throw new Error('Expected second removal')
      useMessageQueueStore.getState().restore(CONV_A, takenSecond)

      expect(
        useMessageQueueStore
          .getState()
          .queues.get(CONV_A)
          ?.map((item) => item.payload.text),
      ).toEqual(['second', 'third'])
    })

    it('restores concurrent failures in original order regardless of completion order', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('first'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('second'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('third'))
      const original = useMessageQueueStore.getState().queues.get(CONV_A)
      const first = original?.[0]
      const second = original?.[1]
      if (!first || !second) throw new Error('Expected queued messages')

      const takenSecond = useMessageQueueStore.getState().take(CONV_A, second.id)
      const takenFirst = useMessageQueueStore.getState().take(CONV_A, first.id)
      if (!takenFirst || !takenSecond) throw new Error('Expected queue removals')
      useMessageQueueStore.getState().restore(CONV_A, takenSecond)
      useMessageQueueStore.getState().restore(CONV_A, takenFirst)

      expect(useMessageQueueStore.getState().queues.get(CONV_A)).toEqual(original)
    })
  })

  describe('clearQueue', () => {
    it('removes all items for a session', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('a'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('b'))
      useMessageQueueStore.getState().clearQueue(CONV_A)
      expect(useMessageQueueStore.getState().queues.has(CONV_A)).toBe(false)
    })

    it('does not affect other sessions', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('a'))
      useMessageQueueStore.getState().enqueue(CONV_B, makePayload('b'))
      useMessageQueueStore.getState().clearQueue(CONV_A)
      expect(useMessageQueueStore.getState().queues.get(CONV_B)).toHaveLength(1)
    })
  })

  describe('promoteToFront', () => {
    it('moves a message to the front of the queue', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('first'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('second'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('third'))
      const queue = useMessageQueueStore.getState().queues.get(CONV_A)
      const secondId = queue?.[1].id ?? ''
      useMessageQueueStore.getState().promoteToFront(CONV_A, secondId)
      const updated = useMessageQueueStore.getState().queues.get(CONV_A)
      expect(updated).toHaveLength(3)
      expect(updated?.[0].payload.text).toBe('second')
      expect(updated?.[1].payload.text).toBe('first')
      expect(updated?.[2].payload.text).toBe('third')
    })

    it('is a no-op when message is already first', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('first'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('second'))
      const queue = useMessageQueueStore.getState().queues.get(CONV_A)
      const firstId = queue?.[0].id ?? ''
      useMessageQueueStore.getState().promoteToFront(CONV_A, firstId)
      const updated = useMessageQueueStore.getState().queues.get(CONV_A)
      expect(updated?.[0].payload.text).toBe('first')
      expect(updated?.[1].payload.text).toBe('second')
    })

    it('is a no-op when message is not found', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('first'))
      useMessageQueueStore.getState().promoteToFront(CONV_A, 'nonexistent')
      const queue = useMessageQueueStore.getState().queues.get(CONV_A)
      expect(queue).toHaveLength(1)
      expect(queue?.[0].payload.text).toBe('first')
    })

    it('is a no-op for empty queue', () => {
      useMessageQueueStore.getState().promoteToFront(CONV_A, 'any-id')
      expect(useMessageQueueStore.getState().queues.has(CONV_A)).toBe(false)
    })
  })

  describe('selectQueue', () => {
    it('returns the queue for a session', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('test'))
      const selector = selectQueue(CONV_A)
      const result = selector(useMessageQueueStore.getState())
      expect(result).toHaveLength(1)
    })

    it('returns stable empty array for null sessionId', () => {
      const selector = selectQueue(null)
      const a = selector(useMessageQueueStore.getState())
      const b = selector(useMessageQueueStore.getState())
      expect(a).toHaveLength(0)
      expect(a).toBe(b)
    })

    it('returns stable empty array for unknown session', () => {
      const selector = selectQueue(CONV_A)
      const a = selector(useMessageQueueStore.getState())
      const b = selector(useMessageQueueStore.getState())
      expect(a).toHaveLength(0)
      expect(a).toBe(b)
    })
  })
})
