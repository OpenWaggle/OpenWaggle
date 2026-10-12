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
import { storeProjectDraftNavigation } from '@/features/sidebar/hooks'
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
  },
}))

/*
 * The message being written on a draft branch while a branch summary is offered or made stays
 * under the draft branch when the view leaves it, whichever way it leaves, as when no summary is
 * offered: never the summary's instructions in its place.
 */

const DRAFT_KEY = 'project:/repo:session:session-1:draft:source-node'
const PENDING_KEY = 'session:session-1:pending'
const MESSAGE = 'The message I was writing'
const INSTRUCTIONS = 'Summarize only the API changes'
const image = fromPartial<PreparedAttachment>({ id: 'image-1', name: 'a.png', sizeBytes: 1 })

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
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

function mountOnDraftBranch(reading: Promise<void> = Promise.resolve()) {
  const params = workflowParams(reading)
  const { result } = renderHook(() => {
    useScopedComposerDrafts(useChatStore((state) => state.activeSessionId))
    return useBranchSummaryWorkflow(params)
  })
  act(() => {
    useComposerStore.getState().setInput(MESSAGE)
    useComposerStore.getState().replaceAttachments([image])
  })
  useBranchSummaryStore.getState().openPrompt({
    sessionId: SESSION_ID,
    projectPath: '/repo',
    sourceNodeId: SOURCE_NODE_ID,
    restoreSelection: { branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID },
    previousComposerText: '',
    draftComposerText: MESSAGE,
  })
  return { params, workflow: () => result.current }
}

function writeCustomInstructions() {
  useBranchSummaryStore.getState().startCustomPrompt(MESSAGE)
  act(() => useComposerStore.getState().setInput(INSTRUCTIONS))
}

/** Clears the prompt and the draft branch without keeping anything, as other views do. */
function leaveWithoutKeeping() {
  act(() => {
    useBranchSummaryStore.getState().clearPrompt()
    useSessionStore.setState({ draftBranch: null })
  })
}

function expectKeptOnItsDraftBranch() {
  expect(useComposerStore.getState().getScopedDraft(DRAFT_KEY)).toEqual(
    expect.objectContaining({ input: MESSAGE, attachments: [image] }),
  )
  expect(useComposerStore.getState().getScopedDraft(PENDING_KEY)).toBeNull()
}

describe('The message on a draft branch with a branch summary prompt', () => {
  beforeEach(() => {
    vi.mocked(api.navigateSessionTree).mockReset()
    usePreferencesStore.setState({ settings: { ...DEFAULT_SETTINGS, projectPath: '/repo' } })
    useBranchSummaryStore.getState().clearPrompt()
    useChatStore.setState({ activeSessionId: SESSION_ID, missingSessionIds: new Set() })
    useComposerStore.setState(useComposerStore.getInitialState())
    useSessionStore.setState({
      activeWorkspace: workspace({ branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
      draftBranch: { sessionId: SESSION_ID, sourceNodeId: SOURCE_NODE_ID },
    })
  })

  it('is kept when the view leaves while a saved summary waits to be shown', async () => {
    vi.mocked(api.navigateSessionTree).mockResolvedValue({ cancelled: false })
    const reading = deferred<void>()
    const { params, workflow } = mountOnDraftBranch(reading.promise)
    let summarized: Promise<void> = Promise.resolve()
    act(() => {
      summarized = workflow().materializeBranchSummary()
    })
    await vi.waitFor(() => expect(params.loadSessions).toHaveBeenCalledTimes(2))

    leaveWithoutKeeping()
    reading.resolve()
    await act(() => summarized)

    expectKeptOnItsDraftBranch()
  })

  it('is kept when the view leaves while the summary is made', async () => {
    const navigation = deferred<{ cancelled: boolean }>()
    vi.mocked(api.navigateSessionTree).mockReturnValue(navigation.promise)
    const { workflow } = mountOnDraftBranch()
    let summarized: Promise<void> = Promise.resolve()
    act(() => {
      summarized = workflow().materializeBranchSummary()
    })

    leaveWithoutKeeping()
    navigation.resolve({ cancelled: false })
    await act(() => summarized)

    expectKeptOnItsDraftBranch()
  })

  it('is kept, not the instructions, when the sidebar leaves a custom summary', () => {
    mountOnDraftBranch()
    writeCustomInstructions()

    act(() => storeProjectDraftNavigation(vi.fn()).clearTransientDraftContext())

    expect(useBranchSummaryStore.getState().prompt).toBeNull()
    expect(useComposerStore.getState().activeDraftContextKey).toBe(
      'project:/repo:session:session-1:branch:main',
    )
    expectKeptOnItsDraftBranch()
  })

  it('stays on its draft branch, not the instructions, when branching from another message', () => {
    const { workflow } = mountOnDraftBranch()
    writeCustomInstructions()

    act(() => {
      workflow().switchComposerToDraftBranch({
        sessionId: SESSION_ID,
        sourceNodeId: SessionNodeId('other-node'),
        fallbackText: '',
        projectPath: '/repo',
      })
    })

    expect(useComposerStore.getState().getScopedDraft(DRAFT_KEY)).toEqual(
      expect.objectContaining({ input: MESSAGE, attachments: [image] }),
    )
  })
})
