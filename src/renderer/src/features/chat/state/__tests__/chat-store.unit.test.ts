import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/features/sessions/state'
import {
  runtimeKeyOf,
  terminalInputDispatcher,
  terminalSidePanelLayoutKey,
  useTerminalStore,
} from '@/features/terminal'
import { useChatStore } from '../chat-store'

// ── Mocks ────────────────────────────────────────────────────

const mockApi = {
  listSessionDetails: vi.fn(),
  listSessions: vi.fn(async (..._args: unknown[]) => []),
  getSessionTree: vi.fn(async (..._args: unknown[]) => null),
  getSessionDetail: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  unregisterBrowserPreviewOwner: vi.fn(async (_ownerKey: string) => undefined),
}

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionDetails: (...args: unknown[]) => mockApi.listSessionDetails(...args),
    listSessions: (...args: unknown[]) => mockApi.listSessions(...args),
    getSessionTree: (...args: unknown[]) => mockApi.getSessionTree(...args),
    getSessionDetail: (...args: unknown[]) => mockApi.getSessionDetail(...args),
    createSession: (...args: unknown[]) => mockApi.createSession(...args),
    deleteSession: (...args: unknown[]) => mockApi.deleteSession(...args),
    unregisterBrowserPreviewOwner: (ownerKey: string) =>
      mockApi.unregisterBrowserPreviewOwner(ownerKey),
  },
}))

// ── Helpers ──────────────────────────────────────────────────

function resetStore() {
  useChatStore.setState({
    sessions: [],
    sessionById: new Map<SessionId, SessionDetail>(),
    missingSessionIds: new Set<SessionId>(),
    draftSession: null,
    activeSessionId: null,
    activeSession: null,
    error: null,
  })
  useSessionStore.setState({
    sessions: [],
    activeSessionTree: null,
    activeWorkspace: null,
    draftBranch: null,
    error: null,
  })
  useTerminalStore.setState({ groups: {}, activity: {}, portPreviews: {}, exits: {} })
}

function makeSessionDetail(id: SessionId, title = 'Session') {
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
    it('sets activeSessionId to null and records the draft project', () => {
      const id = SessionId('test-session-id')
      useChatStore.getState().setActiveSessionId(id)
      useChatStore.getState().startDraftSession('/test/project')
      expect(useChatStore.getState().activeSessionId).toBeNull()
      expect(useChatStore.getState().draftSession).toEqual({ projectPath: '/test/project' })
    })
  })

  describe('createSession', () => {
    it('creates a session and sets the active id', async () => {
      const fakeConv = makeSessionDetail(SessionId('new-session-id'), 'New session')
      mockApi.createSession.mockResolvedValue(fakeConv)

      const result = await useChatStore.getState().createSession('/test/project')
      expect(result).toBe('new-session-id')
      expect(useChatStore.getState().activeSessionId).toBe('new-session-id')
      expect(useChatStore.getState().draftSession).toBeNull()
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
    it('clears active state and prevents deleted sessions from being reselected', async () => {
      const id = SessionId('delete-session-id')
      const session = makeSessionDetail(id)
      useChatStore.getState().upsertSession(session)
      useChatStore.getState().setActiveSessionId(id)
      mockApi.deleteSession.mockResolvedValueOnce(undefined)

      await useChatStore.getState().deleteSession(id)
      useChatStore.getState().setActiveSessionId(id)

      expect(useChatStore.getState().activeSessionId).toBeNull()
      expect(useChatStore.getState().activeSession).toBeNull()
      expect(useChatStore.getState().missingSessionIds.has(id)).toBe(true)
      expect(mockApi.getSessionDetail).not.toHaveBeenCalled()
    })

    it('throws and restores state when api deletion fails', async () => {
      const id = SessionId('delete-session-id')
      const session = makeSessionDetail(id)
      const clearInputOwner = vi.spyOn(terminalInputDispatcher, 'clearOwner')
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
      expect(useChatStore.getState().missingSessionIds.has(id)).toBe(false)
      expect(clearInputOwner).not.toHaveBeenCalled()
      clearInputOwner.mockRestore()
    })

    it('removes base and side terminal state only after session deletion succeeds', async () => {
      const id = SessionId('delete-session-id')
      const ownerKey = String(id)
      const sideOwnerKey = terminalSidePanelLayoutKey(ownerKey)
      const clearInputOwner = vi.spyOn(terminalInputDispatcher, 'clearOwner')
      const terminalStore = useTerminalStore.getState()
      const baseTerminalId = terminalStore.createTerminal(ownerKey, '/repo')
      const sideTerminalId = terminalStore.createTerminal(sideOwnerKey, '/repo')
      if (baseTerminalId === null || sideTerminalId === null) {
        throw new Error('Expected base and side terminals')
      }
      for (const terminalId of [baseTerminalId, sideTerminalId]) {
        terminalStore.applyRuntimeEvent(ownerKey, terminalId, {
          type: 'activity',
          processName: 'node',
        })
        terminalStore.applyRuntimeEvent(ownerKey, terminalId, {
          type: 'port-previews',
          previews: [{ host: 'localhost', port: 3000, url: 'http://localhost:3000/' }],
        })
        terminalStore.applyRuntimeEvent(ownerKey, terminalId, { type: 'exited', exitCode: 3 })
      }
      mockApi.deleteSession.mockResolvedValueOnce(undefined)

      await useChatStore.getState().deleteSession(id)

      const state = useTerminalStore.getState()
      expect(state.groups[ownerKey]).toBeUndefined()
      expect(state.groups[sideOwnerKey]).toBeUndefined()
      expect(clearInputOwner).toHaveBeenCalledOnce()
      expect(clearInputOwner).toHaveBeenCalledWith(ownerKey)
      for (const terminalId of [baseTerminalId, sideTerminalId]) {
        expect(state.activity[runtimeKeyOf(ownerKey, terminalId)]).toBeUndefined()
        expect(state.portPreviews[runtimeKeyOf(ownerKey, terminalId)]).toBeUndefined()
        expect(state.exits[runtimeKeyOf(ownerKey, terminalId)]).toBeUndefined()
      }
      clearInputOwner.mockRestore()
    })

    it('clears active state when a refreshed session no longer exists', async () => {
      const id = SessionId('missing-session-id')
      useChatStore.getState().setActiveSessionId(id)
      mockApi.getSessionDetail.mockResolvedValueOnce(null)

      await useChatStore.getState().refreshSession(id)

      expect(useChatStore.getState().activeSessionId).toBeNull()
      expect(useChatStore.getState().activeSession).toBeNull()
      expect(useChatStore.getState().missingSessionIds.has(id)).toBe(true)
    })
  })

  describe('updateSessionTitle', () => {
    it('does not refresh the active tree for non-active session title updates', async () => {
      const activeId = SessionId('active-session-id')
      const inactiveId = SessionId('inactive-session-id')
      useChatStore.getState().upsertSession(makeSessionDetail(activeId, 'Active'))
      useChatStore.getState().upsertSession(makeSessionDetail(inactiveId, 'Inactive'))
      useChatStore.getState().setActiveSessionId(activeId)

      useChatStore.getState().updateSessionTitle(inactiveId, 'Inactive renamed')
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockApi.listSessions).toHaveBeenCalled()
      expect(mockApi.getSessionTree).not.toHaveBeenCalledWith(inactiveId)
    })

    it('refreshes the active tree for active session title updates', async () => {
      const activeId = SessionId('active-session-id')
      useChatStore.getState().upsertSession(makeSessionDetail(activeId, 'Active'))
      useChatStore.getState().setActiveSessionId(activeId)

      useChatStore.getState().updateSessionTitle(activeId, 'Active renamed')
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockApi.getSessionTree).toHaveBeenCalledWith(activeId)
    })
  })
})
