import { ConversationId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── IPC Mock ───────────────────────────────────────────────
const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    listConversations: vi.fn(),
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    deleteConversation: vi.fn(),
    updateConversationProjectPath: vi.fn(),
  },
}))

vi.mock('@/lib/ipc', () => ({
  api: apiMock,
}))

// Silence the renderer logger so test output stays clean
vi.mock('@/lib/logger', () => ({
  createRendererLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { useChatStore } from './chat-store'

function resetStore(): void {
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    activeConversation: null,
    error: null,
  })
}

describe('useChatStore unit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  // ── loadConversations ──

  describe('loadConversations', () => {
    it('sets error when listConversations throws an Error', async () => {
      apiMock.listConversations.mockRejectedValue(new Error('disk failure'))

      await useChatStore.getState().loadConversations()

      expect(useChatStore.getState().error).toBe('Failed to load conversations: disk failure')
      expect(useChatStore.getState().conversations).toEqual([])
    })

    it('sets error with String fallback when thrown value is not an Error', async () => {
      apiMock.listConversations.mockRejectedValue(404)

      await useChatStore.getState().loadConversations()

      expect(useChatStore.getState().error).toBe('Failed to load conversations: 404')
    })
  })

  // ── createConversation ──

  describe('createConversation', () => {
    it('prepends new summary locally without calling listConversations', async () => {
      const conv = {
        id: ConversationId('new-1'),
        title: 'New thread',
        projectPath: '/repo',
        messages: [],
        createdAt: 100,
        updatedAt: 100,
      }
      apiMock.createConversation.mockResolvedValue(conv)

      useChatStore.setState({
        conversations: [
          {
            id: ConversationId('old-1'),
            title: 'Old',
            projectPath: null,
            messageCount: 5,
            createdAt: 50,
            updatedAt: 50,
          },
        ],
      })

      await useChatStore.getState().createConversation('/repo')

      expect(apiMock.listConversations).not.toHaveBeenCalled()
      const convs = useChatStore.getState().conversations
      expect(convs).toHaveLength(2)
      expect(convs[0].id).toBe('new-1')
      expect(convs[0].messageCount).toBe(0)
      expect(convs[1].id).toBe('old-1')
    })

    it('sets error and re-throws when createConversation fails', async () => {
      apiMock.createConversation.mockRejectedValue(new Error('quota exceeded'))

      await expect(useChatStore.getState().createConversation('/tmp/repo')).rejects.toThrow(
        'quota exceeded',
      )

      expect(useChatStore.getState().error).toBe('Failed to create conversation: quota exceeded')
    })

    it('sets error with String fallback for non-Error thrown values', async () => {
      apiMock.createConversation.mockRejectedValue('boom')

      await expect(useChatStore.getState().createConversation(null)).rejects.toBe('boom')

      expect(useChatStore.getState().error).toBe('Failed to create conversation: boom')
    })
  })

  // ── setActiveConversation ──

  describe('setActiveConversation', () => {
    it('sets error when getConversation throws', async () => {
      apiMock.getConversation.mockRejectedValue(new Error('not found'))

      await useChatStore.getState().setActiveConversation(ConversationId('missing'))

      expect(useChatStore.getState().error).toBe('Failed to load conversation: not found')
      expect(useChatStore.getState().activeConversationId).toBeNull()
      expect(useChatStore.getState().activeConversation).toBeNull()
    })

    it('sets error with String fallback for non-Error values', async () => {
      apiMock.getConversation.mockRejectedValue(undefined)

      await useChatStore.getState().setActiveConversation(ConversationId('x'))

      expect(useChatStore.getState().error).toBe('Failed to load conversation: undefined')
    })
  })

  // ── deleteConversation ──

  describe('deleteConversation', () => {
    it('optimistically removes item without calling listConversations', async () => {
      const id = ConversationId('del-1')
      useChatStore.setState({
        conversations: [
          { id, title: 'Doomed', projectPath: null, messageCount: 1, createdAt: 1, updatedAt: 1 },
        ],
      })
      apiMock.deleteConversation.mockResolvedValue(undefined)

      await useChatStore.getState().deleteConversation(id)

      expect(apiMock.listConversations).not.toHaveBeenCalled()
      expect(useChatStore.getState().conversations).toHaveLength(0)
    })

    it('does not clear active conversation when deleting a different one', async () => {
      const activeId = ConversationId('active-1')
      const deleteId = ConversationId('other-1')

      useChatStore.setState({
        activeConversationId: activeId,
        activeConversation: {
          id: activeId,
          title: 'Active',
          projectPath: null,
          messages: [],
          createdAt: 1,
          updatedAt: 1,
        },
        conversations: [
          {
            id: activeId,
            title: 'Active',
            projectPath: null,
            messageCount: 0,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: deleteId,
            title: 'Other',
            projectPath: null,
            messageCount: 0,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      })

      apiMock.deleteConversation.mockResolvedValue(undefined)

      await useChatStore.getState().deleteConversation(deleteId)

      // Active conversation should remain unchanged
      expect(useChatStore.getState().activeConversationId).toBe(activeId)
      expect(useChatStore.getState().activeConversation?.id).toBe(activeId)
    })

    it('rolls back on error and sets error message', async () => {
      const id = ConversationId('rollback-1')
      const original = [
        { id, title: 'Keep', projectPath: null, messageCount: 0, createdAt: 1, updatedAt: 1 },
      ]
      useChatStore.setState({ conversations: original })

      apiMock.deleteConversation.mockRejectedValue(new Error('permission denied'))

      await useChatStore.getState().deleteConversation(id)

      // Should rollback
      expect(useChatStore.getState().conversations).toHaveLength(1)
      expect(useChatStore.getState().conversations[0].id).toBe(id)
      expect(useChatStore.getState().error).toBe('Failed to delete conversation: permission denied')
    })

    it('sets error with String fallback for non-Error values', async () => {
      apiMock.deleteConversation.mockRejectedValue(null)

      await useChatStore.getState().deleteConversation(ConversationId('x'))

      expect(useChatStore.getState().error).toBe('Failed to delete conversation: null')
    })
  })

  // ── updateConversationProjectPath ──

  describe('updateConversationProjectPath', () => {
    it('patches projectPath locally without calling listConversations', async () => {
      const id = ConversationId('patch-conv')
      useChatStore.setState({
        activeConversationId: id,
        activeConversation: {
          id,
          title: 'Active',
          projectPath: '/old',
          messages: [],
          createdAt: 1,
          updatedAt: 1,
        },
        conversations: [
          { id, title: 'Active', projectPath: '/old', messageCount: 0, createdAt: 1, updatedAt: 1 },
        ],
      })

      apiMock.updateConversationProjectPath.mockResolvedValue({
        id,
        title: 'Active',
        projectPath: '/new',
        messages: [],
        createdAt: 1,
        updatedAt: 2,
      })

      await useChatStore.getState().updateConversationProjectPath(id, '/new')

      expect(apiMock.listConversations).not.toHaveBeenCalled()
      expect(useChatStore.getState().conversations[0].projectPath).toBe('/new')
      expect(useChatStore.getState().activeConversation?.projectPath).toBe('/new')
    })

    it('does not update activeConversation when updating a different conversation', async () => {
      const activeId = ConversationId('active-conv')
      const otherId = ConversationId('other-conv')

      useChatStore.setState({
        activeConversationId: activeId,
        activeConversation: {
          id: activeId,
          title: 'Active',
          projectPath: '/old',
          messages: [],
          createdAt: 1,
          updatedAt: 1,
        },
        conversations: [
          {
            id: activeId,
            title: 'Active',
            projectPath: '/old',
            messageCount: 0,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: otherId,
            title: 'Other',
            projectPath: '/orig',
            messageCount: 0,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      })

      apiMock.updateConversationProjectPath.mockResolvedValue({
        id: otherId,
        title: 'Other',
        projectPath: '/new',
        messages: [],
        createdAt: 1,
        updatedAt: 2,
      })

      await useChatStore.getState().updateConversationProjectPath(otherId, '/new')

      // Active conversation should not be updated
      expect(useChatStore.getState().activeConversation?.projectPath).toBe('/old')
      // But the list entry should be patched
      expect(useChatStore.getState().conversations.find((c) => c.id === otherId)?.projectPath).toBe(
        '/new',
      )
    })

    it('does not update activeConversation when API returns null/undefined', async () => {
      const id = ConversationId('conv-null')

      useChatStore.setState({
        activeConversationId: id,
        activeConversation: {
          id,
          title: 'Existing',
          projectPath: '/original',
          messages: [],
          createdAt: 1,
          updatedAt: 1,
        },
        conversations: [
          {
            id,
            title: 'Existing',
            projectPath: '/original',
            messageCount: 0,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      })

      apiMock.updateConversationProjectPath.mockResolvedValue(null)

      await useChatStore.getState().updateConversationProjectPath(id, '/new')

      // Should not update activeConversation since returned value is falsy
      expect(useChatStore.getState().activeConversation?.projectPath).toBe('/original')
      // But the list entry should still be patched optimistically
      expect(useChatStore.getState().conversations[0].projectPath).toBe('/new')
    })

    it('sets error when updateConversationProjectPath throws', async () => {
      apiMock.updateConversationProjectPath.mockRejectedValue(new Error('write failed'))

      await useChatStore.getState().updateConversationProjectPath(ConversationId('x'), '/somewhere')

      expect(useChatStore.getState().error).toBe('Failed to update project path: write failed')
    })

    it('sets error with String fallback for non-Error values', async () => {
      apiMock.updateConversationProjectPath.mockRejectedValue({ code: 'ERR' })

      await useChatStore.getState().updateConversationProjectPath(ConversationId('x'), '/path')

      expect(useChatStore.getState().error).toContain('Failed to update project path:')
    })
  })

  // ── clearError ──

  describe('clearError', () => {
    it('sets error to null', () => {
      useChatStore.setState({ error: 'some error' })

      useChatStore.getState().clearError()

      expect(useChatStore.getState().error).toBeNull()
    })

    it('is a no-op when error is already null', () => {
      useChatStore.getState().clearError()

      expect(useChatStore.getState().error).toBeNull()
    })
  })
})
