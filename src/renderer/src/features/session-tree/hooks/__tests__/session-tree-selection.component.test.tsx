import { SessionBranchId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionBranch, SessionTree, SessionWorkspace } from '@shared/types/session'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBranchSummaryStore } from '@/features/chat/state'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { node, treeUiState } from '../../lib/__tests__/session-tree-test-fixtures'
import { useSessionTreeNodeSelection } from '../useSessionTreeNodeSelection'

const selectionMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  navigateSessionTree: vi.fn(),
  getPiBranchSummarySkipPrompt: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => selectionMocks.navigate,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getPiBranchSummarySkipPrompt: selectionMocks.getPiBranchSummarySkipPrompt,
    navigateSessionTree: selectionMocks.navigateSessionTree,
  },
}))

const SESSION_ID = SessionId('session-1')
const ROOT_NODE = node({ id: 'root', depth: 0, order: 1 })
const USER_NODE = {
  ...node({ id: 'user', parentId: 'root', depth: 1, order: 2 }),
  kind: 'user_message',
  role: 'user',
  message: {
    id: 'user',
    role: 'user',
    parts: [{ type: 'text', text: 'Use this prompt' }],
    createdAt: 2,
  },
}
const ASSISTANT_NODE = node({ id: 'assistant', parentId: 'user', depth: 2, order: 3 })

function branch(): SessionBranch {
  return {
    id: SessionBranchId('branch-1'),
    sessionId: SESSION_ID,
    sourceNodeId: USER_NODE.id,
    headNodeId: ASSISTANT_NODE.id,
    name: 'branch-1',
    isMain: false,
    createdAt: 1,
    updatedAt: 2,
  }
}

function tree(): SessionTree {
  return {
    session: {
      id: SESSION_ID,
      title: 'Session tree',
      projectPath: '/repo',
      createdAt: 1,
      updatedAt: 2,
    },
    nodes: [ROOT_NODE, USER_NODE, ASSISTANT_NODE],
    branches: [branch()],
    branchStates: [],
    uiState: treeUiState({ expandedNodeIds: ['root'], expandedNodeIdsTouched: true }),
  }
}

function workspace(): SessionWorkspace {
  const sessionTree = tree()
  return {
    tree: sessionTree,
    activeBranchId: SessionBranchId('main'),
    activeNodeId: ASSISTANT_NODE.id,
    transcriptPath: [
      { node: ROOT_NODE, isActive: true },
      { node: USER_NODE, isActive: true },
      { node: ASSISTANT_NODE, isActive: true },
    ],
  }
}

describe('useSessionTreeNodeSelection', () => {
  beforeEach(() => {
    selectionMocks.navigate.mockClear()
    selectionMocks.navigateSessionTree.mockReset()
    selectionMocks.getPiBranchSummarySkipPrompt.mockReset()
    selectionMocks.navigateSessionTree.mockResolvedValue({ cancelled: false })
    selectionMocks.getPiBranchSummarySkipPrompt.mockResolvedValue(true)
    useBranchSummaryStore.getState().clearPrompt()
    useComposerStore.setState({ input: 'previous text', attachments: [], lexicalEditor: null })
    useSessionStore.setState({
      activeWorkspace: workspace(),
      draftBranch: null,
      setDraftBranch: vi.fn((draftBranch) => useSessionStore.setState({ draftBranch })),
      clearDraftBranchForSession: vi.fn(),
      refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
    })
  })

  it('navigates materialized branch nodes through Pi and refreshes the selected workspace', async () => {
    const showToast = vi.fn()
    const refreshSessionWorkspace = vi.fn().mockResolvedValue(undefined)
    const clearDraftBranchForSession = vi.fn()
    useSessionStore.setState({ refreshSessionWorkspace, clearDraftBranchForSession })
    const { result } = renderHook(() =>
      useSessionTreeNodeSelection({
        activeWorkspace: workspace(),
        selectedModel: SupportedModelId('openai/gpt-5.5'),
        showToast,
        tree: tree(),
      }),
    )

    act(() => result.current.selectNode(ASSISTANT_NODE))

    expect(clearDraftBranchForSession).toHaveBeenCalledWith(SESSION_ID)
    expect(selectionMocks.navigate).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: 'session-1' },
      search: expect.any(Function),
    })
    expect(selectionMocks.navigateSessionTree).toHaveBeenCalledWith(
      SESSION_ID,
      SupportedModelId('openai/gpt-5.5'),
      ASSISTANT_NODE.id,
      { summarize: false },
    )
    await waitFor(() =>
      expect(refreshSessionWorkspace).toHaveBeenCalledWith(SESSION_ID, {
        branchId: SessionBranchId('branch-1'),
        nodeId: ASSISTANT_NODE.id,
      }),
    )
    expect(showToast).not.toHaveBeenCalled()
  })

  it('creates a draft branch from user nodes and moves fallback text into the composer', () => {
    const setDraftBranch = vi.fn((draftBranch) => useSessionStore.setState({ draftBranch }))
    const refreshSessionWorkspace = vi.fn().mockResolvedValue(undefined)
    useSessionStore.setState({ setDraftBranch, refreshSessionWorkspace })
    const { result } = renderHook(() =>
      useSessionTreeNodeSelection({
        activeWorkspace: workspace(),
        selectedModel: SupportedModelId('openai/gpt-5.5'),
        showToast: vi.fn(),
        tree: tree(),
      }),
    )

    act(() => result.current.selectNode(USER_NODE))

    expect(setDraftBranch).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      sourceNodeId: ROOT_NODE.id,
    })
    expect(useComposerStore.getState().input).toBe('Use this prompt')
    expect(selectionMocks.navigate).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: 'session-1' },
      search: expect.any(Function),
    })
    expect(refreshSessionWorkspace).toHaveBeenCalledWith(SESSION_ID, { nodeId: ROOT_NODE.id })
  })
})
