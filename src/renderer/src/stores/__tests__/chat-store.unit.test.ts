import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../chat-store'

// ── Mocks ────────────────────────────────────────────────────

const mockApi = {
  listSessionDetails: vi.fn(),
  listSessions: vi.fn(async () => []),
  getSessionTree: vi.fn(async () => null),
  getSessionDetail: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
}

vi.mock('@/lib/ipc', () => ({
  api: {
    listSessionDetails: (...args: unknown[]) => mockApi.listSessionDetails(...args),
    listSessions: (...args: unknown[]) => mockApi.listSessions(...args),
    getSessionTree: (...args: unknown[]) => mockApi.getSessionTree(...args),
    getSessionDetail: (...args: unknown[]) => mockApi.getSessionDetail(...args),
    createSession: (...args: unknown[]) => mockApi.createSession(...args),
    deleteSession: (...args: unknown[]) => mockApi.deleteSession(...args),
  },
}))

// ── Helpers ──────────────────────────────────────────────────

function resetStore(): void {
  useChatStore.setState({
    sessions: [],
    sessionById: new Map<SessionId, SessionDetail>(),
    activeSessionId: null,
    activeSession: null,
    error: null,
  })
}

function makeSessionDetail(id: SessionId, title = 'Session'): SessionDetail {
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
    it('has null activeSessionId', () => {
      expect(useChatStore.getState().activeSessionId).toBeNull()
    })
  })

  describe('setActiveSessionId', () => {
    it('sets the active session from the local cache synchronously', () => {
      const id = SessionId('test-session-id')
      const session = makeSessionDetail(id)
      useChatStore.getState().upsertSession(session)

      useChatStore.getState().setActiveSessionId(id)

      expect(useChatStore.getState().activeSessionId).toBe(id)
      expect(useChatStore.getState().activeSession).toBe(session)
      expect(mockApi.getSessionDetail).not.toHaveBeenCalled()
    })

    it('sets to null', () => {
      const id = SessionId('test-session-id')
      useChatStore.getState().setActiveSessionId(id)
      useChatStore.getState().setActiveSessionId(null)
      expect(useChatStore.getState().activeSessionId).toBeNull()
      expect(useChatStore.getState().activeSession).toBeNull()
    })
  })

  describe('startDraftSession', () => {
    it('sets activeSessionId to null', () => {
      const id = SessionId('test-session-id')
      useChatStore.getState().setActiveSessionId(id)
      useChatStore.getState().startDraftSession()
      expect(useChatStore.getState().activeSessionId).toBeNull()
    })
  })

  describe('createSession', () => {
    it('creates a session and sets the active id', async () => {
      const fakeConv = makeSessionDetail(SessionId('new-session-id'), 'New session')
      mockApi.createSession.mockResolvedValue(fakeConv)

      const result = await useChatStore.getState().createSession('/test/project')
      expect(result).toBe('new-session-id')
      expect(useChatStore.getState().activeSessionId).toBe('new-session-id')
      expect(mockApi.createSession).toHaveBeenCalledWith('/test/project')
    })

    it('throws when api call fails', async () => {
      mockApi.createSession.mockRejectedValue(new Error('API error'))

      await expect(useChatStore.getState().createSession('/test/project')).rejects.toThrow(
        'API error',
      )
    })
  })

  describe('deleteSession', () => {
    it('throws and restores state when api deletion fails', async () => {
      const id = SessionId('delete-session-id')
      const session = makeSessionDetail(id)
      useChatStore.getState().upsertSession(session)
      useChatStore.getState().setActiveSessionId(id)
      mockApi.deleteSession.mockRejectedValueOnce(new Error('Delete failed'))

      await expect(useChatStore.getState().deleteSession(id)).rejects.toThrow('Delete failed')

      expect(useChatStore.getState().sessions).toEqual([
        {
          id,
          title: 'Session',
          projectPath: null,
          messageCount: 0,
          archived: undefined,
          createdAt: 1,
          updatedAt: 1,
        },
      ])
      expect(useChatStore.getState().activeSessionId).toBe(id)
      expect(useChatStore.getState().activeSession).toBe(session)
    })
  })
})
