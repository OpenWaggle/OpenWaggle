import type { ConversationId } from '@shared/types/brand'
import type { ConversationSummary } from '@shared/types/conversation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createConversationNavHandlers } from '../useConversationNav'

type ConversationNavDeps = Parameters<typeof createConversationNavHandlers>[0]

function makeDeps(overrides: Partial<ConversationNavDeps> = {}): ConversationNavDeps {
  return {
    conversations: [] as ConversationSummary[],
    activeConversationId: null as ConversationId | null,
    projectPath: '/test/project' as string | null,
    setActiveView: vi.fn(),
    setProjectPath: vi.fn<(path: string | null) => Promise<void>>().mockResolvedValue(undefined),
    selectFolder: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
    createConversation: vi
      .fn<(p: string | null) => Promise<ConversationId>>()
      .mockResolvedValue('new-conv' as ConversationId),
    startDraftThread: vi.fn(),
    setActiveConversation: vi
      .fn<(id: ConversationId | null) => Promise<void>>()
      .mockResolvedValue(undefined),
    updateConversationProjectPath: vi
      .fn<(id: ConversationId, p: string | null) => Promise<void>>()
      .mockResolvedValue(undefined),
    refreshGitStatus: vi.fn<(p: string | null) => Promise<void>>().mockResolvedValue(undefined),
    refreshGitBranches: vi.fn<(p: string | null) => Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('createConversationNavHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleSelectConversation', () => {
    it('sets view to chat, updates project path when different, refreshes git', async () => {
      const convId = 'conv-1' as ConversationId
      const conversations: ConversationSummary[] = [
        {
          id: convId,
          title: 'Test',
          projectPath: '/other/path',
          messageCount: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ]
      const deps = makeDeps({ conversations, projectPath: '/test/project' })
      const { handleSelectConversation } = createConversationNavHandlers(deps)

      await handleSelectConversation(convId)

      expect(deps.setActiveView).toHaveBeenCalledWith('chat')
      expect(deps.setProjectPath).toHaveBeenCalledWith('/other/path')
      expect(deps.setActiveConversation).toHaveBeenCalledWith(convId)
      expect(deps.refreshGitStatus).toHaveBeenCalledWith('/other/path')
      expect(deps.refreshGitBranches).toHaveBeenCalledWith('/other/path')
    })

    it('skips setProjectPath when project path matches', async () => {
      const convId = 'conv-2' as ConversationId
      const conversations: ConversationSummary[] = [
        {
          id: convId,
          title: 'Same',
          projectPath: '/test/project',
          messageCount: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ]
      const deps = makeDeps({ conversations, projectPath: '/test/project' })
      const { handleSelectConversation } = createConversationNavHandlers(deps)

      await handleSelectConversation(convId)

      expect(deps.setActiveView).toHaveBeenCalledWith('chat')
      expect(deps.setProjectPath).not.toHaveBeenCalled()
      expect(deps.setActiveConversation).toHaveBeenCalledWith(convId)
    })
  })

  describe('handleNewConversation', () => {
    it('sets view to chat and starts draft thread', () => {
      const deps = makeDeps()
      const { handleNewConversation } = createConversationNavHandlers(deps)

      handleNewConversation()

      expect(deps.setActiveView).toHaveBeenCalledWith('chat')
      expect(deps.startDraftThread).toHaveBeenCalled()
      expect(deps.createConversation).not.toHaveBeenCalled()
    })
  })

  describe('handleOpenProject', () => {
    it('with existing conversation: updates path and refreshes git', async () => {
      const convId = 'conv-3' as ConversationId
      const deps = makeDeps({
        activeConversationId: convId,
        selectFolder: vi.fn<() => Promise<string | null>>().mockResolvedValue('/new/project'),
      })
      const { handleOpenProject } = createConversationNavHandlers(deps)

      await handleOpenProject()

      expect(deps.setActiveView).toHaveBeenCalledWith('chat')
      expect(deps.updateConversationProjectPath).toHaveBeenCalledWith(convId, '/new/project')
      expect(deps.setProjectPath).toHaveBeenCalledWith('/new/project')
      expect(deps.setActiveConversation).toHaveBeenCalledWith(convId)
      expect(deps.refreshGitStatus).toHaveBeenCalledWith('/new/project')
    })

    it('without conversation: creates new conversation', async () => {
      const deps = makeDeps({
        activeConversationId: null,
        selectFolder: vi.fn<() => Promise<string | null>>().mockResolvedValue('/new/project'),
      })
      const { handleOpenProject } = createConversationNavHandlers(deps)

      await handleOpenProject()

      expect(deps.setProjectPath).toHaveBeenCalledWith('/new/project')
      expect(deps.createConversation).toHaveBeenCalledWith('/new/project')
      expect(deps.updateConversationProjectPath).not.toHaveBeenCalled()
      expect(deps.refreshGitStatus).toHaveBeenCalledWith('/new/project')
      expect(deps.refreshGitBranches).toHaveBeenCalledWith('/new/project')
    })

    it('when dialog cancelled: no further calls', async () => {
      const deps = makeDeps({
        selectFolder: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
      })
      const { handleOpenProject } = createConversationNavHandlers(deps)

      await handleOpenProject()

      expect(deps.setActiveView).toHaveBeenCalledWith('chat')
      expect(deps.createConversation).not.toHaveBeenCalled()
      expect(deps.setProjectPath).not.toHaveBeenCalled()
    })
  })

  describe('handleSelectProjectPath', () => {
    it('with existing conversation: updates, refreshes', async () => {
      const convId = 'conv-4' as ConversationId
      const deps = makeDeps({ activeConversationId: convId })
      const { handleSelectProjectPath } = createConversationNavHandlers(deps)

      await handleSelectProjectPath('/selected/path')

      expect(deps.setActiveView).toHaveBeenCalledWith('chat')
      expect(deps.updateConversationProjectPath).toHaveBeenCalledWith(convId, '/selected/path')
      expect(deps.setProjectPath).toHaveBeenCalledWith('/selected/path')
      expect(deps.setActiveConversation).toHaveBeenCalledWith(convId)
      expect(deps.refreshGitStatus).toHaveBeenCalledWith('/selected/path')
    })

    it('without conversation: creates new', async () => {
      const deps = makeDeps({ activeConversationId: null })
      const { handleSelectProjectPath } = createConversationNavHandlers(deps)

      await handleSelectProjectPath('/selected/path')

      expect(deps.setProjectPath).toHaveBeenCalledWith('/selected/path')
      expect(deps.createConversation).toHaveBeenCalledWith('/selected/path')
      expect(deps.refreshGitStatus).toHaveBeenCalledWith('/selected/path')
    })
  })
})
