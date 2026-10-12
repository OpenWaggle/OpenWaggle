import { SupportedModelId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { useBranchSummaryStore } from '../../state/branch-summary-store'
import { useChatStore } from '../../state/chat-store'
import { useBranchSummaryWorkflow } from '../useBranchSummaryWorkflow'
import {
  ACTIVE_NODE_ID,
  MAIN_BRANCH_ID,
  SESSION_ID,
  SOURCE_NODE_ID,
  SUMMARY_BRANCH_ID,
  workspace,
} from './branch-summary-workflow-fixtures'

const branchSummaryMocks = vi.hoisted(() => ({
  navigateSessionTree: vi.fn(),
  discardPreparedAttachment: vi.fn(async () => {}),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    navigateSessionTree: branchSummaryMocks.navigateSessionTree,
    discardPreparedAttachment: branchSummaryMocks.discardPreparedAttachment,
  },
}))

const MODEL = SupportedModelId('openai/gpt-5.5')
const navigate = vi.fn()

function openPrompt(projectPath: string | null = '/repo') {
  useBranchSummaryStore.getState().openPrompt({
    sessionId: SESSION_ID,
    projectPath,
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

/*
 * A branch summary that fails says why. One that fails before it is saved offers the choice again;
 * one saved and then not shown is never offered again, which would save a second summary.
 */
describe('useBranchSummaryWorkflow failures', () => {
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

  it.each<[string, string, string]>([
    [
      'a Session whose Pi file cannot be used, as the sentence that says why',
      "This Session's Pi session file was deleted (/p/s.jsonl). Send a message to start a new transcript before going to another branch in it.",
      "This Session's Pi session file was deleted (/p/s.jsonl). Send a message to start a new transcript before going to another branch in it.",
    ],
    [
      'any other failure, without transport text',
      'Session is busy',
      'Failed to summarize the branch: Session is busy',
    ],
  ])('says why the branch summary failed for %s', async (_case, reason, toast) => {
    openPrompt()
    branchSummaryMocks.navigateSessionTree.mockRejectedValue(
      new Error(`Error invoking remote method 'sessions:navigate-tree': Error: ${reason}`),
    )
    const params = workflowParams()
    const { result } = renderHook(() => useBranchSummaryWorkflow(params))

    await act(() => result.current.materializeBranchSummary())

    expect(params.showToast).toHaveBeenCalledWith(toast)
  })

  it('goes to the saved summary, never offering it again, when it cannot be shown', async () => {
    openPrompt()
    useSessionStore.setState({ activeWorkspace: null })
    const params = workflowParams()
    const { result } = renderHook(() => useBranchSummaryWorkflow(params))

    await act(() => result.current.materializeBranchSummary())

    expect(params.showToast).toHaveBeenCalledWith(
      'The branch summary was saved, but it could not be shown: The summarized branch workspace is not available. Please try again.',
    )
    // Summarizing again would save a second summary.
    expect(useBranchSummaryStore.getState().prompt).toBeNull()
    expect(params.clearDraftBranchForSession).toHaveBeenCalledWith(SESSION_ID)
    expect(branchSummaryMocks.navigateSessionTree).toHaveBeenCalledTimes(1)
    // To the Session's position, which the summary moved to its saved branch.
    expect(navigate).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: String(SESSION_ID) },
      search: expect.any(Function),
    })
    const search = navigate.mock.calls.at(-1)?.[0]?.search
    expect(search?.({ diff: undefined })).toEqual({
      diff: undefined,
      branch: undefined,
      node: undefined,
    })
    expect(params.refreshSessionWorkspace).toHaveBeenLastCalledWith(SESSION_ID)
  })
})
