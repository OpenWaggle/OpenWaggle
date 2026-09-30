import {
  MessageId,
  SessionBranchId,
  SessionId,
  SessionNodeId,
  SupportedModelId,
} from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionNode, SessionWorkspace } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { useSessionCopyWorkflow } from '../useSessionCopyWorkflow'

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

function userNode(id: string, sessionId: SessionId): SessionNode {
  return {
    id: SessionNodeId(id),
    sessionId,
    parentId: null,
    piEntryType: 'message',
    kind: 'user_message',
    role: 'user',
    timestampMs: 1,
    createdOrder: 4,
    pathDepth: 0,
    message: {
      id: MessageId(id),
      role: 'user',
      parts: [{ type: 'text', text: 'Retry me' }],
      createdAt: 1,
    },
    contentJson: '{}',
    metadataJson: '{}',
  }
}

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

it('clones the branch head the Host has now, not the head loaded before the last run', async () => {
  const sessionId = SessionId('session-1')
  const staleHead = userNode('stale-head', sessionId)
  const loaded: SessionWorkspace = {
    tree: {
      session: {
        id: sessionId,
        title: 'Session',
        projectPath: '/repo',
        createdAt: 1,
        updatedAt: 1,
        lastActiveNodeId: staleHead.id,
        lastActiveBranchId: SessionBranchId('session-1:main'),
      },
      nodes: [staleHead],
      branches: [
        {
          id: SessionBranchId('session-1:main'),
          sessionId,
          sourceNodeId: null,
          headNodeId: staleHead.id,
          name: 'main',
          isMain: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      branchStates: [],
      uiState: null,
    },
    activeBranchId: SessionBranchId('session-1:main'),
    activeNodeId: staleHead.id,
    transcriptPath: [{ node: staleHead, branchId: null, isActive: true }],
  }
  apiMock.getSessionWorkspace.mockResolvedValue({
    ...loaded,
    activeNodeId: SessionNodeId('current-head'),
  })
  apiMock.cloneSessionToNew.mockResolvedValue({ cancelled: true })
  const { result } = renderHook(() =>
    useSessionCopyWorkflow({
      activeSessionId: sessionId,
      activeWorkspace: loaded,
      messages: [],
      draftBranchSourceNodeId: null,
      model: SupportedModelId('openai/gpt-5.5'),
      navigate: vi.fn(),
      setActiveSession: vi.fn(),
      loadSessions: vi.fn().mockResolvedValue(undefined),
      refreshSession: vi.fn().mockResolvedValue(undefined),
      refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
      showToast: vi.fn(),
    }),
  )

  await act(() => result.current.cloneCurrentSessionToNewSession())

  expect(apiMock.getSessionWorkspace).toHaveBeenCalledWith(sessionId, {
    branchId: SessionBranchId('session-1:main'),
  })
  expect(apiMock.cloneSessionToNew).toHaveBeenCalledWith(
    sessionId,
    SupportedModelId('openai/gpt-5.5'),
    SessionNodeId('current-head'),
  )
})
