import { SessionBranchId, SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type {
  SessionNode,
  SessionTree,
  SessionTreeUiState,
  SessionWorkspace,
} from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildComposerDraftContextKey } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { useBranchSummaryStore } from '../../state/branch-summary-store'
import { useChatStore } from '../../state/chat-store'
import { useBranchSummaryWorkflow } from '../useBranchSummaryWorkflow'

const branchSummaryMocks = vi.hoisted(() => ({
  navigateSessionTree: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    navigateSessionTree: branchSummaryMocks.navigateSessionTree,
  },
}))

const SESSION_ID = SessionId('session-1')
const MODEL = SupportedModelId('openai/gpt-5.5')
const SOURCE_NODE_ID = SessionNodeId('source-node')
const ACTIVE_NODE_ID = SessionNodeId('active-node')
const MAIN_BRANCH_ID = SessionBranchId('main')
const SUMMARY_BRANCH_ID = SessionBranchId('summary-branch')
const navigate = vi.fn()

function node(input: {
  readonly id: string
  readonly parentId?: string | null
  readonly depth: number
  readonly order: number
}): SessionNode {
  return {
    id: SessionNodeId(input.id),
    sessionId: SESSION_ID,
    parentId: input.parentId ? SessionNodeId(input.parentId) : null,
    piEntryType: 'message',
    kind: 'assistant_message',
    role: 'assistant',
    timestampMs: input.order,
    createdOrder: input.order,
    pathDepth: input.depth,
    contentJson: '{}',
    metadataJson: '{}',
  }
}

function treeUiState(): SessionTreeUiState {
  return {
    sessionId: SESSION_ID,
    expandedNodeIds: [SOURCE_NODE_ID],
    expandedNodeIdsTouched: true,
    branchesSidebarCollapsed: false,
    updatedAt: 1,
  }
}

function tree(): SessionTree {
  return {
    session: {
      id: SESSION_ID,
      title: 'Branch workflow',
      projectPath: '/repo',
      createdAt: 1,
      updatedAt: 2,
    },
    nodes: [node({ id: 'source-node', depth: 0, order: 1 })],
    branches: [],
    branchStates: [],
    uiState: treeUiState(),
  }
}

function workspace(input: {
  readonly branchId: SessionBranchId
  readonly nodeId: SessionNodeId
  readonly projectPath?: string | null
  readonly sessionId?: SessionId
}): SessionWorkspace {
  const sessionTree = tree()
  const activeNode = node({ id: String(input.nodeId), depth: 1, order: 2 })
  return {
    tree: {
      ...sessionTree,
      nodes: [...sessionTree.nodes, activeNode],
      session: {
        ...sessionTree.session,
        id: input.sessionId ?? SESSION_ID,
        projectPath: input.projectPath === undefined ? '/repo' : input.projectPath,
      },
    },
    activeBranchId: input.branchId,
    activeNodeId: input.nodeId,
    transcriptPath: [{ node: activeNode, isActive: true }],
  }
}

function openPrompt() {
  useBranchSummaryStore.getState().openPrompt({
    sessionId: SESSION_ID,
    sourceNodeId: SOURCE_NODE_ID,
    restoreSelection: { branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID },
    previousComposerText: 'previous composer text',
    draftComposerText: 'draft branch prompt',
  })
}

function workflowParams() {
  return {
    activeSessionId: SESSION_ID,
    activeWorkspace: workspace({ branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
    clearDraftBranchForSession: vi.fn(),
    loadSessions: vi.fn().mockResolvedValue(undefined),
    model: MODEL,
    navigate,
    projectPath: '/fallback-repo',
    refreshSession: vi.fn().mockResolvedValue(undefined),
    refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
    showToast: vi.fn(),
  } satisfies Parameters<typeof useBranchSummaryWorkflow>[0]
}

describe('useBranchSummaryWorkflow', () => {
  beforeEach(() => {
    branchSummaryMocks.navigateSessionTree.mockReset()
    branchSummaryMocks.navigateSessionTree.mockResolvedValue({ cancelled: false })
    navigate.mockClear()
    useBranchSummaryStore.getState().clearPrompt()
    useChatStore.setState({ activeSessionId: SESSION_ID })
    useSessionStore.setState({
      activeWorkspace: workspace({ branchId: SUMMARY_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
      draftBranch: { sessionId: SESSION_ID, sourceNodeId: SOURCE_NODE_ID },
    })
    useComposerStore.setState({
      activeDraftContextKey: null,
      attachments: [],
      input: 'current composer text',
      lexicalEditor: null,
      scopedDrafts: {},
    })
  })

  it('summarizes a draft branch with trimmed custom instructions and restores the active composer draft', async () => {
    openPrompt()
    useBranchSummaryStore.getState().startCustomPrompt('draft branch prompt')
    const params = workflowParams()
    const { result } = renderHook(() => useBranchSummaryWorkflow(params))

    await act(() => result.current.materializeBranchSummary('  keep architecture rationale  '))

    expect(branchSummaryMocks.navigateSessionTree).toHaveBeenCalledWith(
      SESSION_ID,
      MODEL,
      SOURCE_NODE_ID,
      { summarize: true, customInstructions: 'keep architecture rationale' },
    )
    expect(params.clearDraftBranchForSession).toHaveBeenCalledWith(SESSION_ID)
    expect(params.loadSessions).toHaveBeenCalledOnce()
    expect(params.refreshSession).toHaveBeenCalledWith(SESSION_ID)
    expect(params.refreshSessionWorkspace).toHaveBeenCalledWith(SESSION_ID)
    expect(useBranchSummaryStore.getState().prompt).toBeNull()
    expect(useComposerStore.getState().input).toBe('draft branch prompt')
    expect(navigate).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: 'session-1' },
      search: expect.any(Function),
    })
  })

  it('restores the previous prompt mode when Pi cancels branch summarization', async () => {
    openPrompt()
    useBranchSummaryStore.getState().startCustomPrompt('custom summary')
    branchSummaryMocks.navigateSessionTree.mockResolvedValue({ cancelled: true })
    const params = workflowParams()
    const { result } = renderHook(() => useBranchSummaryWorkflow(params))

    await act(() => result.current.materializeBranchSummary())

    expect(params.showToast).toHaveBeenCalledWith('Branch summarization cancelled.')
    expect(params.clearDraftBranchForSession).not.toHaveBeenCalled()
    expect(useBranchSummaryStore.getState().prompt?.mode).toBe('custom')
    expect(useBranchSummaryStore.getState().prompt?.draftComposerText).toBe('custom summary')
  })

  it('blocks draft sends when the branch source is no longer available', async () => {
    branchSummaryMocks.navigateSessionTree.mockResolvedValue({ cancelled: true })
    const params = workflowParams()
    const { result } = renderHook(() => useBranchSummaryWorkflow(params))

    let sendAllowed = true
    await act(async () => {
      sendAllowed = await result.current.materializeDraftBranchForSend({
        sessionId: SESSION_ID,
        sourceNodeId: SOURCE_NODE_ID,
      })
    })

    expect(sendAllowed).toBe(false)
    expect(params.showToast).toHaveBeenCalledWith('Branch source is no longer available.')
    expect(params.refreshSessionWorkspace).not.toHaveBeenCalled()
  })

  it.each([
    {
      scope: 'canonical project',
      owner: SESSION_ID,
      projectPath: '/repo',
      expectedProject: '/repo',
    },
    { scope: 'canonical no-project', owner: SESSION_ID, projectPath: null, expectedProject: null },
    {
      scope: 'missing workspace',
      owner: null,
      projectPath: null,
      expectedProject: '/fallback-repo',
    },
    {
      scope: 'another Session workspace',
      owner: SessionId('other-session'),
      projectPath: '/other-project',
      expectedProject: '/fallback-repo',
    },
  ])(
    'cancels branch summarization in the original $scope context',
    ({ owner, projectPath, expectedProject }) => {
      openPrompt()
      const params = {
        ...workflowParams(),
        activeWorkspace: owner
          ? workspace({
              branchId: MAIN_BRANCH_ID,
              nodeId: ACTIVE_NODE_ID,
              sessionId: owner,
              projectPath,
            })
          : null,
      }
      useComposerStore.getState().switchScopedDraftContext(
        buildComposerDraftContextKey({
          projectPath: expectedProject,
          sessionId: SESSION_ID,
          draftSourceNodeId: SOURCE_NODE_ID,
        }),
        { input: 'draft branch prompt', attachments: [] },
      )
      const { result } = renderHook(() => useBranchSummaryWorkflow(params))

      act(() => result.current.cancelBranchSummary())

      expect(useBranchSummaryStore.getState().prompt).toBeNull()
      expect(params.clearDraftBranchForSession).toHaveBeenCalledWith(SESSION_ID)
      expect(useComposerStore.getState().input).toBe('previous composer text')
      expect(useComposerStore.getState().activeDraftContextKey).toBe(
        buildComposerDraftContextKey({
          projectPath: expectedProject,
          sessionId: SESSION_ID,
          activeBranchId: MAIN_BRANCH_ID,
          activeNodeId: ACTIVE_NODE_ID,
        }),
      )
      expect(params.refreshSessionWorkspace).toHaveBeenCalledWith(SESSION_ID, {
        branchId: MAIN_BRANCH_ID,
        nodeId: ACTIVE_NODE_ID,
      })
    },
  )

  it('clears the completed source draft under the canonical no-project key', async () => {
    openPrompt()
    const activeWorkspace = workspace({
      branchId: SUMMARY_BRANCH_ID,
      nodeId: ACTIVE_NODE_ID,
      projectPath: null,
    })
    const params = { ...workflowParams(), activeWorkspace }
    useSessionStore.setState({ activeWorkspace })
    const sourceContext = buildComposerDraftContextKey({
      projectPath: null,
      sessionId: SESSION_ID,
      draftSourceNodeId: SOURCE_NODE_ID,
    })
    useComposerStore
      .getState()
      .switchScopedDraftContext(sourceContext, { input: 'draft branch prompt', attachments: [] })
    const { result } = renderHook(() => useBranchSummaryWorkflow(params))

    await act(() => result.current.materializeBranchSummary())

    expect(useComposerStore.getState().input).toBe('draft branch prompt')
    expect(useComposerStore.getState().getScopedDraft(sourceContext)).toBeNull()
    expect(useComposerStore.getState().activeDraftContextKey).toBe(
      buildComposerDraftContextKey({
        projectPath: null,
        sessionId: SESSION_ID,
        activeBranchId: SUMMARY_BRANCH_ID,
        activeNodeId: ACTIVE_NODE_ID,
      }),
    )
  })
})
