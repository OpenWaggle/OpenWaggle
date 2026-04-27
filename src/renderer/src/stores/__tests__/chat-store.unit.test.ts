import { ConversationId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../chat-store'

// ── Mocks ────────────────────────────────────────────────────

const mockApi = {
  listFullConversations: vi.fn(),
  listSessions: vi.fn(async () => []),
  getSessionTree: vi.fn(async () => null),
  getConversation: vi.fn(),
  createConversation: vi.fn(),
  deleteConversation: vi.fn(),
}

vi.mock('@/lib/ipc', () => ({
  api: {
    listFullConversations: (...args: unknown[]) => mockApi.listFullConversations(...args),
    listSessions: (...args: unknown[]) => mockApi.listSessions(...args),
    getSessionTree: (...args: unknown[]) => mockApi.getSessionTree(...args),
    getConversation: (...args: unknown[]) => mockApi.getConversation(...args),
    createConversation: (...args: unknown[]) => mockApi.createConversation(...args),
    deleteConversation: (...args: unknown[]) => mockApi.deleteConversation(...args),
  },
}))

// ── Helpers ──────────────────────────────────────────────────

function resetStore(): void {
  useChatStore.setState({
    conversations: [],
    conversationById: new Map<ConversationId, Conversation>(),
    activeConversationId: null,
    activeConversation: null,
    error: null,
  })
}

function makeConversation(id: ConversationId, title = 'Session'): Conversation {
  return {
    id,
    title,
    projectPath: null,
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  }
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
    it('sets the active conversation from the local cache synchronously', () => {
      const id = ConversationId('test-conv-id')
      const conversation = makeConversation(id)
      useChatStore.getState().upsertConversation(conversation)

      useChatStore.getState().setActiveConversationId(id)

      expect(useChatStore.getState().activeConversationId).toBe(id)
      expect(useChatStore.getState().activeConversation).toBe(conversation)
      expect(mockApi.getConversation).not.toHaveBeenCalled()
    })

    it('sets to null', () => {
      const id = ConversationId('test-conv-id')
      useChatStore.getState().setActiveConversationId(id)
      useChatStore.getState().setActiveConversationId(null)
      expect(useChatStore.getState().activeConversationId).toBeNull()
      expect(useChatStore.getState().activeConversation).toBeNull()
    })
  })

  describe('startDraftSession', () => {
    it('sets activeConversationId to null', () => {
      const id = ConversationId('test-conv-id')
      useChatStore.getState().setActiveConversationId(id)
      useChatStore.getState().startDraftSession()
      expect(useChatStore.getState().activeConversationId).toBeNull()
    })
  })

  describe('createConversation', () => {
    it('creates a conversation and sets the active id', async () => {
      const fakeConv = makeConversation(ConversationId('new-conv-id'), 'New session')
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
