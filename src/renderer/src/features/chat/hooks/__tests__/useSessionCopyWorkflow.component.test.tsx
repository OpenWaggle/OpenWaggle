import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionWorkspace } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useComposerStore } from '@/features/composer/state'
import { useSessionCopyWorkflow } from '../useSessionCopyWorkflow'
import { userNode } from './session-copy-workflow-fixtures'

const apiMock = vi.hoisted(() => ({
  cloneSessionToNew: vi.fn(),
  forkSessionToNew: vi.fn(),
  getSessionWorkspace: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

it('keeps session copy commands safe when there is no active session or fork target', async () => {
  const showToast = vi.fn()
  const { result } = renderHook(() =>
    useSessionCopyWorkflow({
      activeSessionId: null,
      activeWorkspace: null,
      draftBranchSourceNodeId: SessionNodeId('draft-source'),
      model: SupportedModelId('openai/gpt-5.5'),
      messages: [],
      navigate: vi.fn(),
      setActiveSession: vi.fn(),
      loadSessions: vi.fn().mockResolvedValue(undefined),
      refreshSession: vi.fn().mockResolvedValue(undefined),
      refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
      showToast,
    }),
  )

  await act(() => result.current.cloneCurrentSessionToNewSession())
  act(() => result.current.openForkSelector())

  expect(showToast).toHaveBeenCalledWith('No active session to clone.')
  expect(showToast).toHaveBeenCalledWith('No user messages are available to fork.')
})

it('shows the Host reason without Electron transport context when cloning fails', async () => {
  apiMock.getSessionWorkspace.mockResolvedValue(null)
  useChatStore.setState({ activeSessionId: SessionId('session-1') })
  apiMock.cloneSessionToNew.mockRejectedValue(
    new Error("Error invoking remote method 'sessions:clone-to-new': Error: Session is busy"),
  )
  const showToast = vi.fn()
  const { result } = renderHook(() =>
    useSessionCopyWorkflow({
      activeSessionId: SessionId('session-1'),
      activeWorkspace: null,
      draftBranchSourceNodeId: SessionNodeId('draft-source'),
      model: SupportedModelId('openai/gpt-5.5'),
      messages: [],
      navigate: vi.fn(),
      setActiveSession: vi.fn(),
      loadSessions: vi.fn().mockResolvedValue(undefined),
      refreshSession: vi.fn().mockResolvedValue(undefined),
      refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
      showToast,
    }),
  )

  await act(() => result.current.cloneCurrentSessionToNewSession())

  expect(showToast).toHaveBeenCalledWith('Failed to clone session: Session is busy')
})

it('forks the persisted node of a message sent in this window and drafts its text', async () => {
  const sessionId = SessionId('session-1')
  const forkedSessionId = SessionId('session-fork')
  const persisted = userNode('user-node', sessionId)
  const workspace: SessionWorkspace = {
    tree: {
      session: {
        id: sessionId,
        title: 'Session',
        projectPath: '/repo',
        createdAt: 1,
        updatedAt: 1,
        lastActiveNodeId: persisted.id,
        lastActiveBranchId: null,
      },
      nodes: [persisted],
      branches: [],
      branchStates: [],
      uiState: null,
    },
    activeBranchId: null,
    activeNodeId: persisted.id,
    transcriptPath: [{ node: persisted, branchId: null, isActive: true }],
  }
  // The row keeps its optimistic id after the snapshot reconciles it with its node.
  const sentMessage: UIMessage = {
    id: 'optimistic-user-1',
    role: 'user',
    parts: [{ type: 'text', content: 'Retry me' }],
    metadata: { sessionNodeId: 'user-node', sessionNodeCreatedOrder: 4 },
  }
  apiMock.forkSessionToNew.mockResolvedValue({
    cancelled: false,
    editorText: 'Retry me',
    session: {
      id: forkedSessionId,
      title: 'Session',
      projectPath: '/repo',
      messages: [],
      createdAt: 2,
      updatedAt: 2,
    },
  })
  useChatStore.setState({ activeSessionId: sessionId })
  const showToast = vi.fn()
  const { result } = renderHook(() =>
    useSessionCopyWorkflow({
      activeSessionId: sessionId,
      activeWorkspace: workspace,
      messages: [sentMessage],
      draftBranchSourceNodeId: null,
      model: SupportedModelId('openai/gpt-5.5'),
      navigate: vi.fn(),
      setActiveSession: vi.fn(),
      loadSessions: vi.fn().mockResolvedValue(undefined),
      refreshSession: vi.fn().mockResolvedValue(undefined),
      refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
      showToast,
    }),
  )

  await act(() => result.current.forkMessageToNewSession('optimistic-user-1'))

  expect(showToast).not.toHaveBeenCalled()
  expect(apiMock.forkSessionToNew).toHaveBeenCalledWith(
    sessionId,
    SupportedModelId('openai/gpt-5.5'),
    SessionNodeId('user-node'),
  )
  expect(useComposerStore.getState()).toMatchObject({
    activeDraftContextKey: `session:${String(forkedSessionId)}:pending`,
    input: 'Retry me',
  })
})
