import type { ConversationId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../chat-store'

// ── Mocks ────────────────────────────────────────────────────

const mockApi = {
  createConversation: vi.fn(),
}

vi.mock('@/lib/ipc', () => ({
  api: {
    createConversation: (...args: unknown[]) => mockApi.createConversation(...args),
  },
}))

// ── Helpers ──────────────────────────────────────────────────

function resetStore(): void {
  useChatStore.setState({
    activeConversationId: null,
  })
}

// ── Tests ────────────────────────────────────────────────────

describe('useChatStore unit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  afterEach(() => {
    resetStore()
  })

  describe('initial state', () => {
    it('has null activeConversationId', () => {
      expect(useChatStore.getState().activeConversationId).toBeNull()
    })
  })

  describe('setActiveConversationId', () => {
    it('sets the active conversation id', () => {
      const id = 'test-conv-id' as ConversationId
      useChatStore.getState().setActiveConversationId(id)
      expect(useChatStore.getState().activeConversationId).toBe(id)
    })

    it('sets to null', () => {
      const id = 'test-conv-id' as ConversationId
      useChatStore.getState().setActiveConversationId(id)
      useChatStore.getState().setActiveConversationId(null)
      expect(useChatStore.getState().activeConversationId).toBeNull()
    })
  })

  describe('startDraftThread', () => {
    it('sets activeConversationId to null', () => {
      const id = 'test-conv-id' as ConversationId
      useChatStore.getState().setActiveConversationId(id)
      useChatStore.getState().startDraftThread()
      expect(useChatStore.getState().activeConversationId).toBeNull()
    })
  })

  describe('createConversation', () => {
    it('creates a conversation and sets the active id', async () => {
      const fakeConv = { id: 'new-conv-id' as ConversationId }
      mockApi.createConversation.mockResolvedValue(fakeConv)

      const result = await useChatStore.getState().createConversation('/test/project')
      expect(result).toBe('new-conv-id')
      expect(useChatStore.getState().activeConversationId).toBe('new-conv-id')
      expect(mockApi.createConversation).toHaveBeenCalledWith('/test/project')
    })

    it('throws when api call fails', async () => {
      mockApi.createConversation.mockRejectedValue(new Error('API error'))

      await expect(useChatStore.getState().createConversation('/test/project')).rejects.toThrow(
        'API error',
      )
    })
  })
})
