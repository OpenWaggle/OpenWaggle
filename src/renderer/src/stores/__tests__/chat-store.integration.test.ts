import type { ConversationId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../chat-store'

/**
 * Integration tests for the slimmed-down chat store.
 *
 * After the TanStack Query migration, the store only manages:
 * - activeConversationId (pure client state)
 * - createConversation (calls IPC, sets active ID)
 * - startDraftThread (clears active ID)
 *
 * Conversation data fetching and caching is handled by TanStack Query
 * and tested via the query/mutation hooks in src/renderer/src/queries/.
 */

const mockApi = {
  createConversation: vi.fn(),
}

vi.mock('@/lib/ipc', () => ({
  api: {
    createConversation: (...args: unknown[]) => mockApi.createConversation(...args),
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
    activeConversationId: null,
  })
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
    const conv = {
      id: 'conv-1' as ConversationId,
      title: 'New thread',
      projectPath: '/repo',
      messages: [],
      createdAt: 100,
      updatedAt: 100,
    }
    mockApi.createConversation.mockResolvedValue(conv)

    const id = await useChatStore.getState().createConversation('/repo')

    expect(id).toBe('conv-1')
    expect(useChatStore.getState().activeConversationId).toBe('conv-1')
    expect(mockApi.createConversation).toHaveBeenCalledWith('/repo')
  })

  it('sets activeConversationId synchronously', () => {
    const id = 'conv-2' as ConversationId
    useChatStore.getState().setActiveConversationId(id)
    expect(useChatStore.getState().activeConversationId).toBe(id)
  })

  it('startDraftThread clears activeConversationId', () => {
    useChatStore.getState().setActiveConversationId('conv-3' as ConversationId)
    useChatStore.getState().startDraftThread()
    expect(useChatStore.getState().activeConversationId).toBeNull()
  })

  it('throws and preserves state on createConversation failure', async () => {
    mockApi.createConversation.mockRejectedValue(new Error('quota exceeded'))

    await expect(useChatStore.getState().createConversation('/tmp/repo')).rejects.toThrow(
      'quota exceeded',
    )

    expect(useChatStore.getState().activeConversationId).toBeNull()
  })
})
