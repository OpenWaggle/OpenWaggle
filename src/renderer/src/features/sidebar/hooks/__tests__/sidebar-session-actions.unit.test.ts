import { SessionId, SupportedModelId } from '@shared/types/brand'
import { QueryClient } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { createSidebarSessionActions } from '../sidebar-session-actions'

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
