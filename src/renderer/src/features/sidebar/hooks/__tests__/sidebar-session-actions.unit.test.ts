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
  const startDraftSession = vi.fn()
  const actions = createSidebarSessionActions({
    activeSessionId: sessionId,
    matchingActiveSessionTree: null,
    matchingActiveWorkspace: null,
    navigate,
    projectPath: '/project',
    queryClient: new QueryClient(),
    selectedModel: SupportedModelId('openai/gpt-5'),
    showToast,
    startDraftSession,
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
  expect(startDraftSession).not.toHaveBeenCalled()
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
    matchingActiveSessionTree: null,
    matchingActiveWorkspace: null,
    navigate: vi.fn(),
    projectPath: '/project',
    queryClient,
    selectedModel: SupportedModelId('openai/gpt-5'),
    showToast,
    startDraftSession: vi.fn(),
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
