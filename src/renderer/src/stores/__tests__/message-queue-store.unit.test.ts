import type { ConversationId } from '@shared/types/brand'
import type { QualityPreset } from '@shared/types/settings'
import { beforeEach, describe, expect, it } from 'vitest'
import { selectQueue, useMessageQueueStore } from '../message-queue-store'

const CONV_A = 'conv-a' as ConversationId
const CONV_B = 'conv-b' as ConversationId
const QUALITY: QualityPreset = 'medium'

function makePayload(text: string) {
  return { text, qualityPreset: QUALITY, attachments: [] as const }
}

describe('message-queue-store', () => {
  beforeEach(() => {
    useMessageQueueStore.setState({ queues: new Map() })
  })

  describe('enqueue', () => {
    it('adds a message to the queue for a conversation', () => {
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

    it('isolates queues per conversation', () => {
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

    it('removes the conversation key when the last item is dequeued', () => {
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

    it('is a no-op when conversation has no queue', () => {
      useMessageQueueStore.getState().dismiss(CONV_A, 'nonexistent')
      expect(useMessageQueueStore.getState().queues.has(CONV_A)).toBe(false)
    })

    it('removes the conversation key when last item is dismissed', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('only'))
      const queue = useMessageQueueStore.getState().queues.get(CONV_A)
      useMessageQueueStore.getState().dismiss(CONV_A, queue?.[0].id ?? '')
      expect(useMessageQueueStore.getState().queues.has(CONV_A)).toBe(false)
    })
  })

  describe('clearQueue', () => {
    it('removes all items for a conversation', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('a'))
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('b'))
      useMessageQueueStore.getState().clearQueue(CONV_A)
      expect(useMessageQueueStore.getState().queues.has(CONV_A)).toBe(false)
    })

    it('does not affect other conversations', () => {
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
    it('returns the queue for a conversation', () => {
      useMessageQueueStore.getState().enqueue(CONV_A, makePayload('test'))
      const selector = selectQueue(CONV_A)
      const result = selector(useMessageQueueStore.getState())
      expect(result).toHaveLength(1)
    })

    it('returns stable empty array for null conversationId', () => {
      const selector = selectQueue(null)
      const a = selector(useMessageQueueStore.getState())
      const b = selector(useMessageQueueStore.getState())
      expect(a).toHaveLength(0)
      expect(a).toBe(b)
    })

    it('returns stable empty array for unknown conversation', () => {
      const selector = selectQueue(CONV_A)
      const a = selector(useMessageQueueStore.getState())
      const b = selector(useMessageQueueStore.getState())
      expect(a).toHaveLength(0)
      expect(a).toBe(b)
    })
  })
})
