import type { PreparedAttachment } from '@shared/types/agent'
import { type SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, renderHook } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useScopedComposerDrafts } from '@/features/composer/hooks'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
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

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    navigateSessionTree: vi.fn(),
    discardPreparedAttachment: vi.fn(async () => {}),
    getSessionDetail: vi.fn(),
    getSessionTree: vi.fn().mockResolvedValue(null),
    listSessions: vi.fn().mockResolvedValue([]),
    updateSessionTreeUiState: vi.fn().mockResolvedValue(undefined),
    unregisterBrowserPreviewOwner: vi.fn().mockResolvedValue(undefined),
  },
}))

/*
 * A branch summary Pi saved but that could not be shown waits for the Session to be read again
 * before it leaves the draft branch. Meanwhile the prompt stays summarizing, which keeps the
 * composer disabled, and what happens in the Session meanwhile is not undone.
 */

const DRAFT_KEY = 'project:/repo:session:session-1:draft:source-node'
const SUMMARY_KEY = 'project:/repo:session:session-1:branch:summary-branch'
const OTHER_NODE = SessionNodeId('other-node')
const image = fromPartial<PreparedAttachment>({ id: 'image-1', name: 'a.png', sizeBytes: 1 })

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function workflowParams(reading: Promise<void>) {
  return {
    activeSessionId: SESSION_ID,
    activeWorkspace: workspace({ branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
    clearDraftBranchForSession: (sessionId: SessionId) => {
      if (useSessionStore.getState().draftBranch?.sessionId === sessionId) {
        useSessionStore.setState({ draftBranch: null })
      }
    },
    // Reading the Session again takes a while.
    loadSessions: vi.fn(() => reading),
    model: SupportedModelId('openai/gpt-5.5'),
    navigate: vi.fn(),
    projectPath: '/repo',
    refreshSession: vi.fn().mockRejectedValue(new Error('The Session Host is not responding')),
    refreshSessionWorkspace: vi.fn(async () => {
      useSessionStore.setState({
        activeWorkspace: workspace({ branchId: SUMMARY_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
      })
    }),
    showToast: vi.fn(),
  } satisfies Parameters<typeof useBranchSummaryWorkflow>[0]
}

function openPrompt(sourceNodeId: SessionNodeId, draftComposerText: string) {
  useBranchSummaryStore.getState().openPrompt({
    sessionId: SESSION_ID,
    projectPath: '/repo',
    sourceNodeId,
    restoreSelection: { branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID },
    previousComposerText: '',
    draftComposerText,
  })
}

/** Summarizes, and stops once the summary is saved and the Session is being read again. */
async function summarizeUntilReadingAgain() {
  const reading = deferred()
  const params = workflowParams(reading.promise)
  const { result } = renderHook(() => {
    useScopedComposerDrafts(useChatStore((state) => state.activeSessionId))
    return useBranchSummaryWorkflow(params)
  })
  act(() => {
    useComposerStore.getState().setInput('The message I was writing')
    useComposerStore.getState().replaceAttachments([image])
  })
  openPrompt(SOURCE_NODE_ID, 'The message I was writing')
  let summarized: Promise<void> = Promise.resolve()
  act(() => {
    summarized = result.current.materializeBranchSummary()
  })
  await vi.waitFor(() => expect(params.loadSessions).toHaveBeenCalledTimes(2))
  return {
    params,
    finish: async () => {
      reading.resolve()
      await act(() => summarized)
    },
  }
}

describe('A saved branch summary that cannot be shown, while the Session is read again', () => {
  beforeEach(() => {
    vi.mocked(api.navigateSessionTree).mockResolvedValue({ cancelled: false })
    usePreferencesStore.setState({ settings: { ...DEFAULT_SETTINGS, projectPath: '/repo' } })
    useBranchSummaryStore.getState().clearPrompt()
    useChatStore.setState({ activeSessionId: SESSION_ID, missingSessionIds: new Set() })
    useComposerStore.setState(useComposerStore.getInitialState())
    useSessionStore.setState({
      activeWorkspace: workspace({ branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
      draftBranch: { sessionId: SESSION_ID, sourceNodeId: SOURCE_NODE_ID },
    })
  })

  it('keeps the composer disabled and the message where it is, then moves it with the view', async () => {
    const { finish } = await summarizeUntilReadingAgain()

    // Summarizing disables the composer, so nothing typed meanwhile is lost.
    expect(useBranchSummaryStore.getState().prompt?.mode).toBe('summarizing')
    expect(useComposerStore.getState()).toMatchObject({
      activeDraftContextKey: DRAFT_KEY,
      attachments: [image],
    })
    await finish()

    expect(useBranchSummaryStore.getState().prompt).toBeNull()
    expect(useComposerStore.getState()).toMatchObject({
      activeDraftContextKey: SUMMARY_KEY,
      input: 'The message I was writing',
      attachments: [image],
    })
  })

  it('does not undo a branch from another message made meanwhile', async () => {
    const { params, finish } = await summarizeUntilReadingAgain()

    useSessionStore.setState({ draftBranch: { sessionId: SESSION_ID, sourceNodeId: OTHER_NODE } })
    await finish()

    expect(useSessionStore.getState().draftBranch).toEqual({
      sessionId: SESSION_ID,
      sourceNodeId: OTHER_NODE,
    })
    expect(params.navigate).not.toHaveBeenCalled()
  })

  it('leaves a branch summary prompt opened meanwhile to its choice', async () => {
    const { params, finish } = await summarizeUntilReadingAgain()

    useSessionStore.setState({ draftBranch: { sessionId: SESSION_ID, sourceNodeId: OTHER_NODE } })
    openPrompt(OTHER_NODE, 'Another message')
    await finish()

    expect(useBranchSummaryStore.getState().prompt).toMatchObject({
      sourceNodeId: OTHER_NODE,
      mode: 'choice',
      draftComposerText: 'Another message',
    })
    expect(params.navigate).not.toHaveBeenCalled()
  })

  it('carries the message to New session when the Host removes the Session meanwhile', async () => {
    const { finish } = await summarizeUntilReadingAgain()

    vi.mocked(api.getSessionDetail).mockResolvedValue(null)
    await act(() => useChatStore.getState().refreshSession(SESSION_ID))
    await finish()

    expect(useComposerStore.getState().getScopedDraft('project:/repo:new-session')).toEqual(
      expect.objectContaining({ input: 'The message I was writing', attachments: [image] }),
    )
    expect(useComposerStore.getState().getScopedDraft(`session:${SESSION_ID}:pending`)).toBeNull()
  })
})
