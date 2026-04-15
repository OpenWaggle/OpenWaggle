import { ConversationId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { selectCompaction, useCompactionStore } from '../compaction-store'

describe('compaction-store', () => {
  beforeEach(() => {
    // Reset store state
    useCompactionStore.setState({ statuses: new Map() })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const CONV_ID = ConversationId('test-conv-1')

  describe('setStatus', () => {
    it('sets compaction status for a conversation', () => {
      useCompactionStore.getState().setStatus(CONV_ID, {
        stage: 'starting',
        description: 'Compacting...',
        updatedAt: Date.now(),
      })

      const status = useCompactionStore.getState().statuses.get(CONV_ID)
      expect(status?.stage).toBe('starting')
      expect(status?.description).toBe('Compacting...')
    })

    it('auto-dismisses completed status after 3.5s', () => {
      useCompactionStore.getState().setStatus(CONV_ID, {
        stage: 'completed',
        description: 'Done',
        updatedAt: Date.now(),
      })

      expect(useCompactionStore.getState().statuses.has(CONV_ID)).toBe(true)

      vi.advanceTimersByTime(3500)

      expect(useCompactionStore.getState().statuses.has(CONV_ID)).toBe(false)
    })

    it('does not auto-dismiss failed status', () => {
      useCompactionStore.getState().setStatus(CONV_ID, {
        stage: 'failed',
        description: 'Error',
        errorMessage: 'Something went wrong',
        updatedAt: Date.now(),
      })

      vi.advanceTimersByTime(10000)

      expect(useCompactionStore.getState().statuses.has(CONV_ID)).toBe(true)
    })

    it('clears previous auto-dismiss timer when status updates', () => {
      useCompactionStore.getState().setStatus(CONV_ID, {
        stage: 'completed',
        description: 'Done',
        updatedAt: Date.now(),
      })

      // Before timer fires, update to a new starting state
      vi.advanceTimersByTime(1000)
      useCompactionStore.getState().setStatus(CONV_ID, {
        stage: 'starting',
        description: 'New compaction',
        updatedAt: Date.now(),
      })

      // Original timer would have fired at 3500ms
      vi.advanceTimersByTime(3000)

      // Should still be present (starting doesn't auto-dismiss)
      expect(useCompactionStore.getState().statuses.get(CONV_ID)?.stage).toBe('starting')
    })
  })

  describe('clearStatus', () => {
    it('removes status for a conversation', () => {
      useCompactionStore.getState().setStatus(CONV_ID, {
        stage: 'summarizing',
        description: 'Working...',
        updatedAt: Date.now(),
      })

      useCompactionStore.getState().clearStatus(CONV_ID)

      expect(useCompactionStore.getState().statuses.has(CONV_ID)).toBe(false)
    })

    it('is a no-op for unknown conversations', () => {
      const before = useCompactionStore.getState().statuses
      useCompactionStore.getState().clearStatus(ConversationId('unknown'))
      expect(useCompactionStore.getState().statuses).toBe(before)
    })
  })

  describe('selectCompaction', () => {
    it('returns undefined when conversation has no active compaction', () => {
      const selector = selectCompaction(CONV_ID)
      expect(selector(useCompactionStore.getState())).toBeUndefined()
    })

    it('returns the status when compaction is active', () => {
      useCompactionStore.getState().setStatus(CONV_ID, {
        stage: 'summarizing',
        description: 'Working...',
        updatedAt: Date.now(),
      })

      const selector = selectCompaction(CONV_ID)
      const status = selector(useCompactionStore.getState())
      expect(status?.stage).toBe('summarizing')
    })

    it('returns undefined for null conversationId', () => {
      const selector = selectCompaction(null)
      expect(selector(useCompactionStore.getState())).toBeUndefined()
    })
  })
})
