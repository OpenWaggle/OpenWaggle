import { SessionId, SupportedModelId } from '@shared/types/brand'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { queryKeys } from '@/queries/query-keys'
import { createSidebarSessionActions } from '../sidebar-session-actions'

const mocks = vi.hoisted(() => ({
  archiveSession: vi.fn(),
  showConfirm: vi.fn(),
  archiveWorkspaceOwner: vi.fn(),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: mocks }))
vi.mock('@/shell/workspace-panel-cleanup', () => ({
  archiveWorkspaceOwner: mocks.archiveWorkspaceOwner,
  deleteWorkspaceOwner: vi.fn(),
}))

beforeEach(() => {
  mocks.archiveSession.mockReset().mockResolvedValue(undefined)
  mocks.showConfirm.mockReset().mockResolvedValue(true)
  mocks.archiveWorkspaceOwner.mockReset().mockResolvedValue(undefined)
})

it('shows the deletion reason without transport details and does not navigate away', async () => {
  const sessionId = SessionId('queen')
  const reason = "Delete this session's Workers before deleting their Queen session."
  const showToast = vi.fn()
  const navigate = vi.fn()
  const actions = createSidebarSessionActions({
    activeSessionId: sessionId,
    getActiveSessionId: () => sessionId,
    getVisibleSessionIds: () => [sessionId],
    selectSession: vi.fn(),
    clearActiveSession: vi.fn(),
    matchingActiveSessionTree: null,
    matchingActiveWorkspace: null,
    navigate,
    projectPath: '/project',
    queryClient: new QueryClient(),
    selectedModel: SupportedModelId('openai/gpt-5'),
    showToast,
    clearTransientDraftContext: vi.fn(),
    deleteSession: async () => {
      throw new Error(`Error invoking remote method 'sessions:delete': Error: ${reason}`)
    },
    loadChatSessions: async () => {},
    loadSessionTrees: async () => {},
    refreshSessionWorkspace: async () => {},
    togglePin: vi.fn(),
  })

  actions.delete(sessionId)

  await vi.waitFor(() => {
    expect(showToast).toHaveBeenCalledWith(`Failed to delete session: ${reason}`)
  })
  expect(navigate).not.toHaveBeenCalled()
})

it('refreshes a committed archive after cleanup fails and preserves that error if reload also fails', async () => {
  const id = SessionId('archived-worker')
  const queryClient = new QueryClient()
  queryClient.setQueryData(queryKeys.archivedSessions, [])
  queryClient.setQueryData(queryKeys.sessionHive(id), { current: { id } })
  mocks.archiveWorkspaceOwner.mockRejectedValue(new Error('Local workspace cleanup failed'))
  const loadChatSessions = vi.fn(async () => {
    throw new Error('Reload failed')
  })
  const loadSessionTrees = vi.fn(async () => undefined)
  const showToast = vi.fn()
  const actions = createSidebarSessionActions({
    activeSessionId: null,
    getActiveSessionId: () => null,
    getVisibleSessionIds: () => [id],
    selectSession: vi.fn(),
    clearActiveSession: vi.fn(),
    matchingActiveSessionTree: null,
    matchingActiveWorkspace: null,
    navigate: vi.fn(),
    projectPath: '/project',
    queryClient,
    selectedModel: SupportedModelId('openai/gpt-5'),
    showToast,
    clearTransientDraftContext: vi.fn(),
    deleteSession: vi.fn(),
    loadChatSessions,
    loadSessionTrees,
    refreshSessionWorkspace: vi.fn(),
    togglePin: vi.fn(),
  })

  actions.archive(id)

  await vi.waitFor(() =>
    expect(showToast).toHaveBeenCalledWith(
      'Failed to archive session: Local workspace cleanup failed',
    ),
  )
  expect(mocks.archiveSession).toHaveBeenCalledWith(id)
  expect(mocks.archiveWorkspaceOwner).toHaveBeenCalledWith(id)
  expect(loadChatSessions).toHaveBeenCalledOnce()
  expect(loadSessionTrees).toHaveBeenCalledOnce()
  expect(queryClient.getQueryState(queryKeys.archivedSessions)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(queryKeys.sessionHive(id))?.isInvalidated).toBe(true)
  queryClient.clear()
})

function archiveActions(input: {
  readonly activeSessionId: SessionId | null
  readonly visibleSessionIds: readonly SessionId[]
}) {
  const navigate = vi.fn()
  const selectSession = vi.fn()
  const clearActiveSession = vi.fn()
  const showToast = vi.fn()
  const actions = createSidebarSessionActions({
    activeSessionId: input.activeSessionId,
    getActiveSessionId: () => input.activeSessionId,
    getVisibleSessionIds: () => input.visibleSessionIds,
    selectSession,
    clearActiveSession,
    matchingActiveSessionTree: null,
    matchingActiveWorkspace: null,
    navigate,
    projectPath: '/project',
    queryClient: new QueryClient(),
    selectedModel: SupportedModelId('openai/gpt-5'),
    showToast,
    clearTransientDraftContext: vi.fn(),
    deleteSession: vi.fn(async () => undefined),
    loadChatSessions: async () => {},
    loadSessionTrees: async () => {},
    refreshSessionWorkspace: async () => {},
    togglePin: vi.fn(),
  })
  return { actions, navigate, selectSession, clearActiveSession, showToast }
}

it('archives without asking for confirmation, which is reserved for deletion', async () => {
  const id = SessionId('b')
  const { actions } = archiveActions({ activeSessionId: null, visibleSessionIds: [id] })

  actions.archive(id)

  await vi.waitFor(() => expect(mocks.archiveSession).toHaveBeenCalledWith(id))
  expect(mocks.showConfirm).not.toHaveBeenCalled()
})

it('opens the next visible session instead of starting a new one when the active session is archived', async () => {
  const [a, b, c] = [SessionId('a'), SessionId('b'), SessionId('c')]
  const { actions, selectSession, navigate } = archiveActions({
    activeSessionId: b,
    visibleSessionIds: [a, b, c],
  })

  actions.archive(b)

  await vi.waitFor(() => expect(selectSession).toHaveBeenCalledWith(c))
  expect(navigate).not.toHaveBeenCalledWith({ to: '/' })
})

it('falls back to the previous visible session when the archived session was last', async () => {
  const [a, b] = [SessionId('a'), SessionId('b')]
  const { actions, selectSession, navigate } = archiveActions({
    activeSessionId: b,
    visibleSessionIds: [a, b],
  })

  actions.archive(b)

  await vi.waitFor(() => expect(selectSession).toHaveBeenCalledWith(a))
  expect(navigate).not.toHaveBeenCalledWith({ to: '/' })
})

it('returns to the empty home without a draft session when no other session remains', async () => {
  const only = SessionId('only')
  const { actions, clearActiveSession, navigate, selectSession } = archiveActions({
    activeSessionId: only,
    visibleSessionIds: [only],
  })

  actions.archive(only)

  await vi.waitFor(() => expect(clearActiveSession).toHaveBeenCalledOnce())
  expect(navigate).toHaveBeenCalledWith({ to: '/' })
  expect(selectSession).not.toHaveBeenCalled()
})

it('keeps the current session open when a different session is archived', async () => {
  const [a, b] = [SessionId('a'), SessionId('b')]
  const { actions, clearActiveSession, navigate, selectSession } = archiveActions({
    activeSessionId: a,
    visibleSessionIds: [a, b],
  })

  actions.archive(b)

  await vi.waitFor(() => expect(mocks.archiveSession).toHaveBeenCalledWith(b))
  await Promise.resolve()
  expect(selectSession).not.toHaveBeenCalled()
  expect(clearActiveSession).not.toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
})
