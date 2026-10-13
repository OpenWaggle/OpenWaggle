import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { ProviderInfo } from '@shared/types/llm'
import type { SessionDetail, SessionWorkspace } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useComposerStore } from '@/features/composer/state'
import { useProviderStore } from '@/features/providers/state'
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

it('shows why a Session whose Pi file cannot be used is not cloned, as a plain sentence', async () => {
  apiMock.getSessionWorkspace.mockResolvedValue(null)
  useChatStore.setState({ activeSessionId: SessionId('session-1') })
  const reason =
    "This Session's Pi session file was deleted (/p/s.jsonl). Send a message to start a new transcript before cloning it."
  apiMock.cloneSessionToNew.mockRejectedValue(
    new Error(
      `Error invoking remote method 'sessions:clone-to-new': Error: SessionLifecyclePreparationError (prepare-session-lifecycle): ${reason}`,
    ),
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

  expect(showToast).toHaveBeenCalledWith(reason)
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

it('forks a Session whose model is gone, so the Host falls back to the model that answered last', async () => {
  const sessionId = SessionId('session-gone-model')
  const mini = SupportedModelId('openai/gpt-4.1-mini')
  const persisted = userNode('user-node', sessionId)
  useProviderStore.setState({
    providerModels: [
      fromPartial<ProviderInfo>({
        provider: 'openai',
        models: [fromPartial({ id: mini, name: 'GPT 4.1 mini', available: true })],
      }),
    ],
    catalogHydrated: true,
  })
  useChatStore.setState({
    activeSessionId: sessionId,
    sessionById: new Map([
      [
        sessionId,
        fromPartial<SessionDetail>({
          id: sessionId,
          messages: [fromPartial({ role: 'assistant', model: mini })],
        }),
      ],
    ]),
  })
  apiMock.forkSessionToNew.mockReset().mockResolvedValue({ cancelled: true })
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
  const showToast = vi.fn()
  const { result } = renderHook(() =>
    useSessionCopyWorkflow({
      activeSessionId: sessionId,
      activeWorkspace: workspace,
      messages: [
        {
          id: 'user-row',
          role: 'user',
          parts: [{ type: 'text', content: 'Hi' }],
          metadata: { sessionNodeId: String(persisted.id), sessionNodeCreatedOrder: 1 },
        },
      ],
      draftBranchSourceNodeId: null,
      model: SupportedModelId('router/removed-auto'),
      navigate: vi.fn(),
      setActiveSession: vi.fn(),
      loadSessions: vi.fn().mockResolvedValue(undefined),
      refreshSession: vi.fn().mockResolvedValue(undefined),
      refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
      showToast,
    }),
  )

  await act(() => result.current.forkMessageToNewSession('user-row'))

  expect(showToast).not.toHaveBeenCalledWith('Select a model before forking.')
  expect(apiMock.forkSessionToNew).toHaveBeenCalledWith(
    sessionId,
    SupportedModelId('router/removed-auto'),
    SessionNodeId('user-node'),
  )
})
