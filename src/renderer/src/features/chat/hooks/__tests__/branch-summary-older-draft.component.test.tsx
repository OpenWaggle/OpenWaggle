import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { leaveBranchSummaryPrompt } from '@/features/chat/state'
import { useScopedComposerDrafts } from '@/features/composer/hooks'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { storeProjectDraftNavigation } from '@/features/sidebar/hooks'
import { useBranchSummaryStore } from '../../state/branch-summary-store'
import { useChatStore } from '../../state/chat-store'
import {
  ACTIVE_NODE_ID,
  MAIN_BRANCH_ID,
  SESSION_ID,
  SOURCE_NODE_ID,
  workspace,
} from './branch-summary-workflow-fixtures'

vi.mock('@/shared/lib/ipc', () => ({
  api: { navigateSessionTree: vi.fn(), discardPreparedAttachment: vi.fn(async () => {}) },
}))

/*
 * Leaving a draft branch while a branch summary is offered keeps its message under the draft
 * branch, as before a summary was offered, and never replaces a draft not sent yet on the branch
 * the view goes to.
 */

const MAIN_KEY = 'project:/repo:session:session-1:branch:main'
const OTHER_KEY = 'project:/repo:session:session-1:branch:other'
const DRAFT_KEY = 'project:/repo:session:session-1:draft:source-node'
const OLDER = 'An older draft on main'
const MESSAGE = 'The message on the draft branch'

function onDraftBranchWithPrompt() {
  renderHook(() => useScopedComposerDrafts(useChatStore((state) => state.activeSessionId)))
  act(() => useComposerStore.getState().setInput(OLDER))
  // Branching from a message: the draft branch, then the composer on it.
  act(() => {
    useSessionStore.setState({
      draftBranch: { sessionId: SESSION_ID, sourceNodeId: SOURCE_NODE_ID },
    })
    useComposerStore.getState().switchScopedDraftContext(DRAFT_KEY, {
      input: MESSAGE,
      attachments: [],
    })
  })
  useBranchSummaryStore.getState().openPrompt({
    sessionId: SESSION_ID,
    projectPath: '/repo',
    sourceNodeId: SOURCE_NODE_ID,
    restoreSelection: { branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID },
    previousComposerText: OLDER,
    draftComposerText: MESSAGE,
  })
}

function expectMessageKeptOnItsDraftBranch() {
  expect(useComposerStore.getState().getScopedDraft(DRAFT_KEY)?.input).toBe(MESSAGE)
  expect(useComposerStore.getState().getScopedDraft('session:session-1:pending')).toBeNull()
}

describe('Leaving a draft branch with a branch summary offered', () => {
  beforeEach(() => {
    usePreferencesStore.setState({ settings: { ...DEFAULT_SETTINGS, projectPath: '/repo' } })
    useBranchSummaryStore.getState().clearPrompt()
    useChatStore.setState({ activeSessionId: SESSION_ID, missingSessionIds: new Set() })
    useComposerStore.setState(useComposerStore.getInitialState())
    useSessionStore.setState({
      activeWorkspace: workspace({ branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
      draftBranch: null,
    })
    onDraftBranchWithPrompt()
  })

  it('from the sidebar shows the older draft of the branch it goes to', () => {
    act(() => storeProjectDraftNavigation(vi.fn()).clearTransientDraftContext())

    expect(useComposerStore.getState()).toMatchObject({
      activeDraftContextKey: MAIN_KEY,
      input: OLDER,
    })
    expectMessageKeptOnItsDraftBranch()
  })

  it('to another branch shows that branch’s older draft', () => {
    useComposerStore.getState().saveScopedDraft(OTHER_KEY, {
      input: 'An older draft on other',
      attachments: [],
    })

    act(() => {
      leaveBranchSummaryPrompt()
      useSessionStore.setState({
        draftBranch: null,
        activeWorkspace: workspace({
          branchId: SessionBranchId('other'),
          nodeId: SessionNodeId('other-node'),
        }),
      })
    })

    expect(useComposerStore.getState()).toMatchObject({
      activeDraftContextKey: OTHER_KEY,
      input: 'An older draft on other',
    })
    expectMessageKeptOnItsDraftBranch()
  })

  it('for another Session, and back, shows the older draft, not the summary instructions', () => {
    useBranchSummaryStore.getState().startCustomPrompt(MESSAGE)
    act(() => useComposerStore.getState().setInput('Summarize only the API changes'))
    const other = SessionId('session-2')

    act(() => {
      storeProjectDraftNavigation(vi.fn()).clearTransientDraftContext()
      useChatStore.setState({ activeSessionId: other })
      useSessionStore.setState({
        activeWorkspace: workspace({
          branchId: MAIN_BRANCH_ID,
          nodeId: ACTIVE_NODE_ID,
          sessionId: other,
        }),
      })
    })
    act(() => useChatStore.setState({ activeSessionId: SESSION_ID }))
    act(() =>
      useSessionStore.setState({
        activeWorkspace: workspace({ branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
      }),
    )

    expect(useComposerStore.getState()).toMatchObject({
      activeDraftContextKey: MAIN_KEY,
      input: OLDER,
    })
    expectMessageKeptOnItsDraftBranch()
  })
})
