import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionNavHandlers } from '../useSessionNav'

type SessionNavDeps = Parameters<typeof createSessionNavHandlers>[0]

function makeDeps(overrides: Partial<SessionNavDeps> = {}): SessionNavDeps {
  return {
    sessions: [] as SessionSummary[],
    projectPath: '/test/project' as string | null,
    setActiveView: vi.fn(),
    setProjectPath: vi.fn<(path: string | null) => Promise<void>>().mockResolvedValue(undefined),
    selectFolder: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
    startDraftSession: vi.fn(),
    setActiveSession: vi.fn<(id: SessionId | null) => Promise<void>>().mockResolvedValue(undefined),
    refreshGitStatus: vi.fn<(p: string | null) => Promise<void>>().mockResolvedValue(undefined),
    refreshGitBranches: vi.fn<(p: string | null) => Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('createSessionNavHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleSelectSession', () => {
    it('sets view to chat, updates project path when different, refreshes git', async () => {
      const convId = 'session-1' as SessionId
      const sessions: SessionSummary[] = [
        {
          id: convId,
          title: 'Test',
          projectPath: '/other/path',
          messageCount: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ]
      const deps = makeDeps({ sessions, projectPath: '/test/project' })
      const { handleSelectSession } = createSessionNavHandlers(deps)

      await handleSelectSession(convId)

      expect(deps.setActiveView).toHaveBeenCalledWith('chat')
      expect(deps.setProjectPath).toHaveBeenCalledWith('/other/path')
      expect(deps.setActiveSession).toHaveBeenCalledWith(convId)
      expect(deps.refreshGitStatus).toHaveBeenCalledWith('/other/path')
      expect(deps.refreshGitBranches).toHaveBeenCalledWith('/other/path')
    })

    it('skips setProjectPath when project path matches', async () => {
      const convId = 'session-2' as SessionId
      const sessions: SessionSummary[] = [
        {
          id: convId,
          title: 'Same',
          projectPath: '/test/project',
          messageCount: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ]
      const deps = makeDeps({ sessions, projectPath: '/test/project' })
      const { handleSelectSession } = createSessionNavHandlers(deps)

      await handleSelectSession(convId)

      expect(deps.setActiveView).toHaveBeenCalledWith('chat')
      expect(deps.setProjectPath).not.toHaveBeenCalled()
      expect(deps.setActiveSession).toHaveBeenCalledWith(convId)
    })
  })

  describe('handleNewSession', () => {
    it('sets view to chat and starts draft session', () => {
      const deps = makeDeps()
      const { handleNewSession } = createSessionNavHandlers(deps)

      handleNewSession()

      expect(deps.setActiveView).toHaveBeenCalledWith('chat')
      expect(deps.startDraftSession).toHaveBeenCalled()
    })
  })

  describe('handleOpenProject', () => {
    it('selects a project and starts a draft session', async () => {
      const deps = makeDeps({
        selectFolder: vi.fn<() => Promise<string | null>>().mockResolvedValue('/new/project'),
      })
      const { handleOpenProject } = createSessionNavHandlers(deps)

      await handleOpenProject()

      expect(deps.setActiveView).toHaveBeenCalledWith('chat')
      expect(deps.setProjectPath).toHaveBeenCalledWith('/new/project')
      expect(deps.startDraftSession).toHaveBeenCalled()
      expect(deps.refreshGitStatus).toHaveBeenCalledWith('/new/project')
      expect(deps.refreshGitBranches).toHaveBeenCalledWith('/new/project')
    })

    it('when dialog cancelled: no further calls', async () => {
      const deps = makeDeps({
        selectFolder: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
      })
      const { handleOpenProject } = createSessionNavHandlers(deps)

      await handleOpenProject()

      expect(deps.setActiveView).toHaveBeenCalledWith('chat')
      expect(deps.startDraftSession).not.toHaveBeenCalled()
      expect(deps.setProjectPath).not.toHaveBeenCalled()
    })
  })

  describe('handleSelectProjectPath', () => {
    it('selects project and starts a draft session', async () => {
      const deps = makeDeps()
      const { handleSelectProjectPath } = createSessionNavHandlers(deps)

      await handleSelectProjectPath('/selected/path')

      expect(deps.setProjectPath).toHaveBeenCalledWith('/selected/path')
      expect(deps.startDraftSession).toHaveBeenCalled()
      expect(deps.refreshGitStatus).toHaveBeenCalledWith('/selected/path')
    })
  })
})
