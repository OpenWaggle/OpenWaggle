import type { PreparedAttachment } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
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
    getSessionWorkspace: vi.fn(),
    discardPreparedAttachment: vi.fn(async () => {}),
  },
}))

/*
 * A branch summary made while the view is on another Session lands all the same. The Session's
 * view goes to the summary's branch, now or once it is shown again, and the message written on
 * the draft branch goes there with it, after a draft not sent yet there, never in place of one.
 */

const MAIN_KEY = 'project:/repo:session:session-1:branch:main'
const SUMMARY_KEY = 'project:/repo:session:session-1:branch:summary-branch'
const DRAFT_KEY = 'project:/repo:session:session-1:draft:source-node'
const MESSAGE = 'The message I was writing'
const OTHER_SESSION = SessionId('session-2')
const image = fromPartial<PreparedAttachment>({ id: 'image-1', name: 'a.png', sizeBytes: 1 })
const mainWorkspace = () => workspace({ branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID })
const summaryWorkspace = () => workspace({ branchId: SUMMARY_BRANCH_ID, nodeId: ACTIVE_NODE_ID })

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function workflowParams() {
  return {
    activeSessionId: SESSION_ID,
    activeWorkspace: mainWorkspace(),
    clearDraftBranchForSession: (sessionId: SessionId) => {
      if (useSessionStore.getState().draftBranch?.sessionId === sessionId) {
        useSessionStore.setState({ draftBranch: null })
      }
    },
    loadSessions: vi.fn().mockResolvedValue(undefined),
    model: SupportedModelId('openai/gpt-5.5'),
    navigate: vi.fn(),
    projectPath: '/repo',
    refreshSession: vi.fn().mockResolvedValue(undefined),
    // The Session's workspace, once read again, is on the summary's branch.
    refreshSessionWorkspace: vi.fn(async (sessionId: SessionId) => {
      if (useChatStore.getState().activeSessionId === sessionId) {
        useSessionStore.setState({ activeWorkspace: summaryWorkspace() })
      }
    }),
    showToast: vi.fn(),
  } satisfies Parameters<typeof useBranchSummaryWorkflow>[0]
}

function show(sessionId: SessionId, shown = mainWorkspace()) {
  act(() => {
    useChatStore.setState({ activeSessionId: sessionId })
    useSessionStore.setState({
      activeWorkspace:
        sessionId === SESSION_ID
          ? shown
          : workspace({ branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID, sessionId }),
    })
  })
}

async function summarizeAndLeave(mode: 'choice' | 'custom') {
  const navigation = deferred<{ cancelled: boolean }>()
  vi.mocked(api.navigateSessionTree).mockReturnValue(navigation.promise)
  const params = workflowParams()
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
  if (mode === 'custom') {
    useBranchSummaryStore.getState().startCustomPrompt(MESSAGE)
    act(() => useComposerStore.getState().setInput('Summarize only the API changes'))
  }
  let summarized: Promise<void> = Promise.resolve()
  act(() => {
    summarized = result.current.materializeBranchSummary(
      mode === 'custom' ? 'Summarize only the API changes' : undefined,
    )
  })
  // The user picks another Session in the sidebar while the summary is made.
  act(() => storeProjectDraftNavigation(vi.fn()).clearTransientDraftContext())
  show(OTHER_SESSION)
  return {
    params,
    land: async () => {
      navigation.resolve({ cancelled: false })
      await act(() => summarized)
    },
  }
}

function expectMessageOnTheSummaryBranch() {
  expect(useComposerStore.getState()).toMatchObject({
    activeDraftContextKey: SUMMARY_KEY,
    input: `An older draft on the summary branch\n\n${MESSAGE}`,
    attachments: [image],
  })
  expect(useComposerStore.getState().getScopedDraft(MAIN_KEY)?.input).toBe('An older draft on main')
  expect(useComposerStore.getState().getScopedDraft(DRAFT_KEY)).toBeNull()
  expect(useComposerStore.getState().getScopedDraft('session:session-1:pending')).toBeNull()
}

describe('A branch summary that lands while the view is elsewhere', () => {
  beforeEach(() => {
    vi.mocked(api.getSessionWorkspace).mockResolvedValue(summaryWorkspace())
    usePreferencesStore.setState({ settings: { ...DEFAULT_SETTINGS, projectPath: '/repo' } })
    useBranchSummaryStore.getState().clearPrompt()
    useChatStore.setState({ activeSessionId: SESSION_ID, missingSessionIds: new Set() })
    useComposerStore.setState(useComposerStore.getInitialState())
    useComposerStore.getState().saveScopedDraft(MAIN_KEY, {
      input: 'An older draft on main',
      attachments: [],
    })
    useComposerStore.getState().saveScopedDraft(SUMMARY_KEY, {
      input: 'An older draft on the summary branch',
      attachments: [],
    })
    useSessionStore.setState({
      activeWorkspace: mainWorkspace(),
      draftBranch: { sessionId: SESSION_ID, sourceNodeId: SOURCE_NODE_ID },
    })
  })

  it.each(['choice', 'custom'] as const)(
    'in %s mode, shows the summary’s branch with the message once the Session is shown again',
    async (mode) => {
      const { land } = await summarizeAndLeave(mode)

      await land()
      // The Session is shown again where the Host left it: on the summary's branch.
      show(SESSION_ID, summaryWorkspace())

      expectMessageOnTheSummaryBranch()
      expect(api.getSessionWorkspace).toHaveBeenCalledWith(SESSION_ID)
    },
  )

  it.each(['choice', 'custom'] as const)(
    'in %s mode, moves the view shown again to the summary’s branch, with the message',
    async (mode) => {
      const { params, land } = await summarizeAndLeave(mode)
      show(SESSION_ID)
      expect(useComposerStore.getState()).toMatchObject({
        activeDraftContextKey: MAIN_KEY,
        input: 'An older draft on main',
      })

      await land()

      expect(params.refreshSessionWorkspace).toHaveBeenCalledWith(SESSION_ID)
      expect(params.navigate).toHaveBeenCalledWith(
        expect.objectContaining({ params: { sessionId: String(SESSION_ID) } }),
      )
      expectMessageOnTheSummaryBranch()
    },
  )
})
