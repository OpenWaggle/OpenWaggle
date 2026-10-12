import type { PreparedAttachment } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import { SupportedModelId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useScopedComposerDrafts } from '@/features/composer/hooks'
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

const mocks = vi.hoisted(() => ({ navigateSessionTree: vi.fn() }))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    navigateSessionTree: mocks.navigateSessionTree,
    discardPreparedAttachment: vi.fn(async () => {}),
  },
}))

/*
 * A branch summary Pi saved but that could not be shown is not offered again. The message being
 * written on the draft branch goes with the view to the Session's saved branch, with its
 * attachments, through the real composer drafts.
 */

const DRAFT_KEY = 'project:/repo:session:session-1:draft:source-node'
const SUMMARY_KEY = 'project:/repo:session:session-1:branch:summary-branch'
const image = fromPartial<PreparedAttachment>({ id: 'image-1', name: 'a.png', sizeBytes: 1 })

function workflowParams() {
  return {
    activeSessionId: SESSION_ID,
    activeWorkspace: workspace({ branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
    clearDraftBranchForSession: (sessionId: SessionId) => {
      if (useSessionStore.getState().draftBranch?.sessionId === sessionId) {
        useSessionStore.setState({ draftBranch: null })
      }
    },
    loadSessions: vi.fn().mockResolvedValue(undefined),
    model: SupportedModelId('openai/gpt-5.5'),
    navigate: vi.fn(),
    projectPath: '/repo',
    // Showing the saved summary fails.
    refreshSession: vi.fn().mockRejectedValue(new Error('The Session Host is not responding')),
    // The Session's workspace, once read again, is on the saved summary's branch.
    refreshSessionWorkspace: vi.fn(async () => {
      useSessionStore.setState({
        activeWorkspace: workspace({ branchId: SUMMARY_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
      })
    }),
    showToast: vi.fn(),
  } satisfies Parameters<typeof useBranchSummaryWorkflow>[0]
}

function mountOnDraftBranch() {
  const params = workflowParams()
  const { result } = renderHook(() => {
    useScopedComposerDrafts(SESSION_ID)
    return useBranchSummaryWorkflow(params)
  })
  expect(useComposerStore.getState().activeDraftContextKey).toBe(DRAFT_KEY)
  return { params, workflow: () => result.current }
}

function openPrompt(draftComposerText: string) {
  useBranchSummaryStore.getState().openPrompt({
    sessionId: SESSION_ID,
    projectPath: '/repo',
    sourceNodeId: SOURCE_NODE_ID,
    restoreSelection: { branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID },
    previousComposerText: '',
    draftComposerText,
  })
}

describe('A saved branch summary that cannot be shown', () => {
  beforeEach(() => {
    mocks.navigateSessionTree.mockReset()
    mocks.navigateSessionTree.mockResolvedValue({ cancelled: false })
    useBranchSummaryStore.getState().clearPrompt()
    useChatStore.setState({ activeSessionId: SESSION_ID })
    useComposerStore.setState(useComposerStore.getInitialState())
    useSessionStore.setState({
      activeWorkspace: workspace({ branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
      draftBranch: { sessionId: SESSION_ID, sourceNodeId: SOURCE_NODE_ID },
    })
  })

  it('keeps the message being written, chosen from the summary choice', async () => {
    const { workflow } = mountOnDraftBranch()
    act(() => {
      useComposerStore.getState().setInput('The message I was writing')
      useComposerStore.getState().replaceAttachments([image])
    })
    openPrompt('The message I was writing')

    await act(() => workflow().materializeBranchSummary())

    expect(useBranchSummaryStore.getState().prompt).toBeNull()
    expect(useComposerStore.getState()).toMatchObject({
      activeDraftContextKey: SUMMARY_KEY,
      input: 'The message I was writing',
      attachments: [image],
    })
    expect(useComposerStore.getState().getScopedDraft(DRAFT_KEY)).toBeNull()
  })

  it('keeps the message being written, not the instructions of a custom summary', async () => {
    const { workflow } = mountOnDraftBranch()
    act(() => useComposerStore.getState().replaceAttachments([image]))
    openPrompt('')
    useBranchSummaryStore.getState().startCustomPrompt('The message I was writing')
    act(() => useComposerStore.getState().setInput('Summarize only the API changes'))

    await act(() => workflow().materializeBranchSummary('Summarize only the API changes'))

    expect(useComposerStore.getState()).toMatchObject({
      activeDraftContextKey: SUMMARY_KEY,
      input: 'The message I was writing',
      attachments: [image],
    })
    expect(useComposerStore.getState().getScopedDraft(DRAFT_KEY)).toBeNull()
  })
})
