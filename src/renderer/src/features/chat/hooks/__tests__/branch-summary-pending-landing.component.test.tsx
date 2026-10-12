import type { PreparedAttachment } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import { SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, renderHook } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useScopedComposerDrafts } from '@/features/composer/hooks'
import { carryRemovedSessionDraft, useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
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

const DRAFT_KEY = 'project:/repo:session:session-1:draft:source-node'
const SUMMARY_KEY = 'project:/repo:session:session-1:branch:summary-branch'
const PENDING_KEY = 'session:session-1:pending'
const image = fromPartial<PreparedAttachment>({ id: 'image-1', name: 'a.png', sizeBytes: 1 })

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/*
 * A branch summary saved but not shown while the Session's workspace is not shown lands its
 * message on the draft the Session owns before its workspace is shown. It goes, with its image,
 * after a draft not sent yet on the branch the workspace then shows, or to New session with the
 * Session if the Host removes it. Nothing is left under the draft branch it ended.
 */
describe('A saved branch summary landing before the Session’s workspace is shown', () => {
  beforeEach(() => {
    mocks.navigateSessionTree.mockReset()
    mocks.navigateSessionTree.mockResolvedValue({ cancelled: false })
    useBranchSummaryStore.getState().clearPrompt()
    useChatStore.setState({ activeSessionId: SESSION_ID, missingSessionIds: new Set() })
    useComposerStore.setState(useComposerStore.getInitialState())
    useSessionStore.setState({
      activeWorkspace: workspace({ branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
      draftBranch: { sessionId: SESSION_ID, sourceNodeId: SOURCE_NODE_ID },
    })
  })

  it('keeps the message and the older draft on the branch the view finally lands on', async () => {
    useComposerStore.getState().saveScopedDraft(SUMMARY_KEY, {
      input: 'An older draft on the summary branch',
      attachments: [],
    })
    const reads: ReturnType<typeof deferred>[] = []
    const params = {
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
      refreshSession: vi.fn().mockResolvedValue(undefined),
      refreshSessionWorkspace: vi.fn(() => {
        const read = deferred()
        reads.push(read)
        return read.promise
      }),
      showToast: vi.fn(),
    } satisfies Parameters<typeof useBranchSummaryWorkflow>[0]
    const { result } = renderHook(() => {
      useScopedComposerDrafts(SESSION_ID)
      return useBranchSummaryWorkflow(params)
    })
    expect(useComposerStore.getState().activeDraftContextKey).toBe(DRAFT_KEY)
    act(() => {
      useComposerStore.getState().setInput('The message I was writing')
      useComposerStore.getState().replaceAttachments([image])
    })
    useBranchSummaryStore.getState().openPrompt({
      sessionId: SESSION_ID,
      projectPath: '/repo',
      sourceNodeId: SOURCE_NODE_ID,
      restoreSelection: { branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID },
      previousComposerText: '',
      draftComposerText: 'The message I was writing',
    })

    let done: Promise<void> = Promise.resolve()
    act(() => {
      done = result.current.materializeBranchSummary()
    })
    await act(async () => {
      for (let i = 0; i < 10 && reads.length < 1; i += 1) await Promise.resolve()
    })
    expect(reads.length).toBe(1)
    // The first read publishes no workspace for the Session (getSessionWorkspace -> null).
    act(() => useSessionStore.setState({ activeWorkspace: null }))
    await act(async () => {
      reads[0]?.resolve()
      for (let i = 0; i < 20 && reads.length < 2; i += 1) await Promise.resolve()
    })
    expect(reads.length).toBe(2)
    await act(async () => {
      reads[1]?.resolve()
      await done
    })
    expect(useBranchSummaryStore.getState().prompt).toBeNull()

    // The workspace arrives later, on the summary branch.
    act(() =>
      useSessionStore.setState({
        activeWorkspace: workspace({ branchId: SUMMARY_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
      }),
    )
    const finalState = useComposerStore.getState()
    expect(finalState).toMatchObject({
      activeDraftContextKey: SUMMARY_KEY,
      input: 'An older draft on the summary branch\n\nThe message I was writing',
      attachments: [image],
    })
    expect(finalState.getScopedDraft(PENDING_KEY)).toBeNull()
  })

  it('carries the message when the Session is then removed', async () => {
    useComposerStore.getState().saveScopedDraft(SUMMARY_KEY, {
      input: 'An older draft on the summary branch',
      attachments: [],
    })
    const reads: ReturnType<typeof deferred>[] = []
    const params = {
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
      refreshSession: vi.fn().mockResolvedValue(undefined),
      refreshSessionWorkspace: vi.fn(() => {
        const read = deferred()
        reads.push(read)
        return read.promise
      }),
      showToast: vi.fn(),
    } satisfies Parameters<typeof useBranchSummaryWorkflow>[0]
    const { result } = renderHook(() => {
      useScopedComposerDrafts(SESSION_ID)
      return useBranchSummaryWorkflow(params)
    })
    expect(useComposerStore.getState().activeDraftContextKey).toBe(DRAFT_KEY)
    act(() => {
      useComposerStore.getState().setInput('The message I was writing')
      useComposerStore.getState().replaceAttachments([image])
    })
    useBranchSummaryStore.getState().openPrompt({
      sessionId: SESSION_ID,
      projectPath: '/repo',
      sourceNodeId: SOURCE_NODE_ID,
      restoreSelection: { branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID },
      previousComposerText: '',
      draftComposerText: 'The message I was writing',
    })

    usePreferencesStore.setState({ settings: { ...DEFAULT_SETTINGS, projectPath: '/repo' } })
    let done: Promise<void> = Promise.resolve()
    act(() => {
      done = result.current.materializeBranchSummary()
    })
    await act(async () => {
      for (let i = 0; i < 10 && reads.length < 1; i += 1) await Promise.resolve()
    })
    expect(reads.length).toBe(1)
    // The first read publishes no workspace for the Session (getSessionWorkspace -> null).
    act(() => useSessionStore.setState({ activeWorkspace: null }))
    await act(async () => {
      reads[0]?.resolve()
      for (let i = 0; i < 20 && reads.length < 2; i += 1) await Promise.resolve()
    })
    expect(reads.length).toBe(2)
    await act(async () => {
      reads[1]?.resolve()
      await done
    })
    expect(useBranchSummaryStore.getState().prompt).toBeNull()

    carryRemovedSessionDraft(SESSION_ID)
    const st = useComposerStore.getState()
    expect(st.getScopedDraft('project:/repo:new-session')?.input).toContain(
      'The message I was writing',
    )
  })
})

describe('A saved branch summary with a Waggle preset picked on its draft branch', () => {
  beforeEach(() => {
    mocks.navigateSessionTree.mockReset()
    mocks.navigateSessionTree.mockResolvedValue({ cancelled: false })
    useBranchSummaryStore.getState().clearPrompt()
    useChatStore.setState({ activeSessionId: SESSION_ID, missingSessionIds: new Set() })
    useComposerStore.setState(useComposerStore.getInitialState())
    useSessionStore.setState({
      activeWorkspace: workspace({ branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
      draftBranch: { sessionId: SESSION_ID, sourceNodeId: SOURCE_NODE_ID },
    })
  })
  it('leaves nothing under the ended draft branch', async () => {
    const params = {
      activeSessionId: SESSION_ID,
      activeWorkspace: workspace({ branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
      clearDraftBranchForSession: (sessionId: SessionId) => {
        if (useSessionStore.getState().draftBranch?.sessionId === sessionId)
          useSessionStore.setState({ draftBranch: null })
      },
      loadSessions: vi.fn().mockResolvedValue(undefined),
      model: SupportedModelId('openai/gpt-5.5'),
      navigate: vi.fn(),
      projectPath: '/repo',
      refreshSession: vi.fn().mockRejectedValue(new Error('Host down')),
      refreshSessionWorkspace: vi.fn(async () => {
        useSessionStore.setState({
          activeWorkspace: workspace({ branchId: SUMMARY_BRANCH_ID, nodeId: ACTIVE_NODE_ID }),
        })
      }),
      showToast: vi.fn(),
    } satisfies Parameters<typeof useBranchSummaryWorkflow>[0]
    const { result } = renderHook(() => {
      useScopedComposerDrafts(SESSION_ID)
      return useBranchSummaryWorkflow(params)
    })
    act(() => {
      useComposerStore.getState().setInput('msg')
      useComposerStore.getState().setSelectedWagglePreset(fromPartial({ id: 'preset-1' }))
    })
    useBranchSummaryStore.getState().openPrompt({
      sessionId: SESSION_ID,
      projectPath: '/repo',
      sourceNodeId: SOURCE_NODE_ID,
      restoreSelection: { branchId: MAIN_BRANCH_ID, nodeId: ACTIVE_NODE_ID },
      previousComposerText: '',
      draftComposerText: 'msg',
    })
    await act(() => result.current.materializeBranchSummary())
    const s = useComposerStore.getState()
    expect(s.getScopedDraft(DRAFT_KEY)).toBeNull()
  })
})
