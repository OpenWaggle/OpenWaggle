import { ConversationId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../chat-store'

/**
 * Integration tests for the renderer conversation read model.
 * Full conversations are cached locally so session navigation can select the
 * target transcript synchronously without waiting on per-click IPC.
 */

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

vi.mock('@/lib/logger', () => ({
  createRendererLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

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
    projectPath: '/repo',
    messages: [],
    createdAt: 100,
    updatedAt: 100,
  }
}

describe('useChatStore integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  afterEach(() => {
    resetStore()
  })

  it('starts with null activeConversationId', () => {
    expect(useChatStore.getState().activeConversationId).toBeNull()
  })

  it('creates a conversation and marks it active', async () => {
    const conv = makeConversation(ConversationId('conv-1'), 'New session')
    mockApi.createConversation.mockResolvedValue(conv)

    const id = await useChatStore.getState().createConversation('/repo')

    expect(id).toBe('conv-1')
    expect(useChatStore.getState().activeConversationId).toBe('conv-1')
    expect(mockApi.createConversation).toHaveBeenCalledWith('/repo')
  })

  it('sets activeConversationId synchronously', () => {
    const id = ConversationId('conv-2')
    const conversation = makeConversation(id)
    useChatStore.getState().upsertConversation(conversation)

    useChatStore.getState().setActiveConversationId(id)

    expect(useChatStore.getState().activeConversationId).toBe(id)
    expect(useChatStore.getState().activeConversation).toBe(conversation)
  })

  it('startDraftSession clears activeConversationId', () => {
    useChatStore.getState().setActiveConversationId(ConversationId('conv-3'))
    useChatStore.getState().startDraftSession()
    expect(useChatStore.getState().activeConversationId).toBeNull()
  })

  it('loads full conversations and switches between them without fetching on click', async () => {
    const first = makeConversation(ConversationId('conv-first'), 'First')
    const second = makeConversation(ConversationId('conv-second'), 'Second')
    mockApi.listFullConversations.mockResolvedValue([first, second])

    await useChatStore.getState().loadConversations()
    useChatStore.getState().setActiveConversationId(second.id)

    expect(useChatStore.getState().conversations.map((conversation) => conversation.id)).toEqual([
      first.id,
      second.id,
    ])
    expect(useChatStore.getState().activeConversation).toBe(second)
    expect(mockApi.getConversation).not.toHaveBeenCalled()
  })

  it('throws and preserves state on createConversation failure', async () => {
    mockApi.createConversation.mockRejectedValue(new Error('quota exceeded'))

    await expect(useChatStore.getState().createConversation('/tmp/repo')).rejects.toThrow(
      'quota exceeded',
    )

    expect(useChatStore.getState().activeConversationId).toBeNull()
  })
})
