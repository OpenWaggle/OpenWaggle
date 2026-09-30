import { SessionBranchId, SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useSessionCopyWorkflow } from '../useSessionCopyWorkflow'
import { userNode } from './session-copy-workflow-fixtures'

const apiMock = vi.hoisted(() => ({
  cloneSessionToNew: vi.fn(),
  forkSessionToNew: vi.fn(),
  getSessionWorkspace: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

/** The loaded workspace is not refreshed after a run, so copies read the Host workspace. */
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
  useChatStore.setState({ activeSessionId: sessionId })
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

it('lists fork targets from the Host, including a message sent since the workspace loaded', async () => {
  const sessionId = SessionId('session-1')
  const sent = userNode('sent-since-load', sessionId)
  apiMock.getSessionWorkspace.mockResolvedValue({
    tree: {
      session: {
        id: sessionId,
        title: 'Session',
        projectPath: '/repo',
        createdAt: 1,
        updatedAt: 2,
        lastActiveNodeId: sent.id,
        lastActiveBranchId: null,
      },
      nodes: [sent],
      branches: [],
      branchStates: [],
      uiState: null,
    },
    activeBranchId: null,
    activeNodeId: sent.id,
    transcriptPath: [{ node: sent, branchId: null, isActive: true }],
  } satisfies SessionWorkspace)
  useChatStore.setState({ activeSessionId: sessionId })
  const showToast = vi.fn()
  const { result } = renderHook(() =>
    useSessionCopyWorkflow({
      activeSessionId: sessionId,
      activeWorkspace: null,
      messages: [],
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

  act(() => result.current.openForkSelector())

  await waitFor(() => expect(result.current.forkSelectorOpen).toBe(true))
  expect(showToast).not.toHaveBeenCalled()
  expect(result.current.forkTargets).toEqual([
    { entryId: SessionNodeId('sent-since-load'), text: 'Retry me' },
  ])
})

it('lists fork targets up to an earlier node the view selected, without reading the Host', async () => {
  const sessionId = SessionId('session-1')
  const earlier = userNode('earlier-user', sessionId)
  const branchId = SessionBranchId('session-1:main')
  const pinned: SessionWorkspace = {
    tree: {
      session: {
        id: sessionId,
        title: 'Session',
        projectPath: '/repo',
        createdAt: 1,
        updatedAt: 1,
        lastActiveNodeId: SessionNodeId('later-head'),
        lastActiveBranchId: branchId,
      },
      nodes: [earlier],
      branches: [
        {
          id: branchId,
          sessionId,
          sourceNodeId: null,
          headNodeId: SessionNodeId('later-head'),
          name: 'main',
          isMain: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      branchStates: [],
      uiState: null,
    },
    activeBranchId: branchId,
    activeNodeId: earlier.id,
    transcriptPath: [{ node: earlier, branchId, isActive: true }],
  }
  apiMock.getSessionWorkspace.mockReset()
  useChatStore.setState({ activeSessionId: sessionId })
  const { result } = renderHook(() =>
    useSessionCopyWorkflow({
      activeSessionId: sessionId,
      activeWorkspace: pinned,
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

  act(() => result.current.openForkSelector())

  await waitFor(() => expect(result.current.forkSelectorOpen).toBe(true))
  expect(apiMock.getSessionWorkspace).not.toHaveBeenCalled()
  expect(result.current.forkTargets).toEqual([
    { entryId: SessionNodeId('earlier-user'), text: 'Retry me' },
  ])
})
