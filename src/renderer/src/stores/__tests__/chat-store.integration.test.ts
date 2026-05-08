import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../chat-store'

/**
 * Integration tests for the renderer session read model.
 * Full sessions are cached locally so session navigation can select the
 * target transcript synchronously without waiting on per-click IPC.
 */

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

  it('starts with null activeSessionId', () => {
    expect(useChatStore.getState().activeSessionId).toBeNull()
  })

  it('creates a session and marks it active', async () => {
    const session = makeSessionDetail(SessionId('session-1'), 'New session')
    mockApi.createSession.mockResolvedValue(session)

    const id = await useChatStore.getState().createSession('/repo')

    expect(id).toBe('session-1')
    expect(useChatStore.getState().activeSessionId).toBe('session-1')
    expect(mockApi.createSession).toHaveBeenCalledWith('/repo')
  })

  it('sets activeSessionId synchronously', () => {
    const id = SessionId('session-2')
    const session = makeSessionDetail(id)
    useChatStore.getState().upsertSession(session)

    useChatStore.getState().setActiveSessionId(id)

    expect(useChatStore.getState().activeSessionId).toBe(id)
    expect(useChatStore.getState().activeSession).toBe(session)
  })

  it('startDraftSession clears activeSessionId', () => {
    useChatStore.getState().setActiveSessionId(SessionId('session-3'))
    useChatStore.getState().startDraftSession()
    expect(useChatStore.getState().activeSessionId).toBeNull()
  })

  it('loads full sessions and switches between them without fetching on click', async () => {
    const first = makeSessionDetail(SessionId('session-first'), 'First')
    const second = makeSessionDetail(SessionId('session-second'), 'Second')
    mockApi.listSessionDetails.mockResolvedValue([first, second])

    await useChatStore.getState().loadSessions()
    useChatStore.getState().setActiveSessionId(second.id)

    expect(useChatStore.getState().sessions.map((session) => session.id)).toEqual([
      first.id,
      second.id,
    ])
    expect(useChatStore.getState().activeSession).toBe(second)
    expect(mockApi.getSessionDetail).not.toHaveBeenCalled()
  })

  it('throws and preserves state on createSession failure', async () => {
    mockApi.createSession.mockRejectedValue(new Error('quota exceeded'))

    await expect(useChatStore.getState().createSession('/tmp/repo')).rejects.toThrow(
      'quota exceeded',
    )

    expect(useChatStore.getState().activeSessionId).toBeNull()
  })
})
