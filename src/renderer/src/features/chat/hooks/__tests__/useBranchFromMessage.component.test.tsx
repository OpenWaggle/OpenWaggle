import { SessionId, SessionNodeId } from '@shared/types/brand'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildComposerDraftContextKey } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { UserMessageBubble } from '../../components/UserMessageBubble'
import { useBranchSummaryStore } from '../../state/branch-summary-store'
import { useChatStore } from '../../state/chat-store'
import { useBranchFromMessage } from '../useBranchFromMessage'
import { useBranchSummaryWorkflow } from '../useBranchSummaryWorkflow'
import {
  deferredWorkspace,
  MESSAGE,
  SESSION_ID,
  SOURCE_ID,
  workflowParams,
  workspace,
} from './branch-from-message.test-utils'

const mocks = vi.hoisted(() => ({
  getSessionWorkspace: vi.fn(),
  getPiBranchSummarySkipPrompt: vi.fn(),
  href: '/sessions/session-1',
}))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSessionWorkspace: mocks.getSessionWorkspace,
    getPiBranchSummarySkipPrompt: mocks.getPiBranchSummarySkipPrompt,
  },
}))
vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => mocks.href,
  useSearch: () => ({}),
}))
vi.mock('@/features/workspace-files/hooks', () => ({ useOpenWorkspaceFile: () => vi.fn() }))

function BranchButton({ params }: { readonly params: ReturnType<typeof workflowParams> }) {
  const summary = useBranchSummaryWorkflow(params)
  const onBranchFromMessage = useBranchFromMessage({
    ...params,
    messages: [MESSAGE],
    switchComposerToDraftBranch: summary.switchComposerToDraftBranch,
  })
  return <UserMessageBubble message={MESSAGE} onBranchFromMessage={onBranchFromMessage} />
}

function clickBranch() {
  fireEvent.click(screen.getByTitle('Branch from message'))
}

function expectBranch(params: ReturnType<typeof workflowParams>) {
  expect(useSessionStore.getState().draftBranch).toEqual({
    sessionId: SESSION_ID,
    sourceNodeId: SOURCE_ID,
  })
  expect(useComposerStore.getState().input).toBe('Branch from this user node')
  expect(useComposerStore.getState().activeDraftContextKey).toBe(
    buildComposerDraftContextKey({
      sessionId: SESSION_ID,
      projectPath: '/repo',
      draftSourceNodeId: SOURCE_ID,
    }),
  )
  expect(params.refreshSessionWorkspace).toHaveBeenCalledWith(SESSION_ID, { nodeId: SOURCE_ID })
}

describe('Branch from message canonical source readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPiBranchSummarySkipPrompt.mockResolvedValue(true)
    mocks.href = '/sessions/session-1'
    useChatStore.setState({ activeSessionId: SESSION_ID })
    useSessionStore.setState({ activeWorkspace: null, draftBranch: null })
    useBranchSummaryStore.getState().clearPrompt()
    useComposerStore.setState({
      activeDraftContextKey: null,
      input: 'Existing draft',
      attachments: [],
      lexicalEditor: null,
      scopedDrafts: {},
    })
  })

  it('waits for late workspace data before creating the user retry draft from its parent', async () => {
    const pending = deferredWorkspace()
    mocks.getSessionWorkspace.mockReturnValue(pending.promise)
    const params = workflowParams()
    const view = render(<BranchButton params={params} />)
    clickBranch()
    expect(useSessionStore.getState().draftBranch).toBeNull()
    expect(useComposerStore.getState().input).toBe('Existing draft')

    // The normal workspace query can hydrate while the action's read is pending.
    view.rerender(<BranchButton params={{ ...params, activeWorkspace: workspace() }} />)
    await act(async () => pending.resolve(workspace()))
    expectBranch(params)
  })

  it('keeps the already hydrated action synchronous without a new workspace read', () => {
    const params = workflowParams(workspace())
    render(<BranchButton params={params} />)
    clickBranch()
    expectBranch(params)
    expect(mocks.getSessionWorkspace).not.toHaveBeenCalled()
  })

  it('offers branch summarization when the action read wins normal workspace hydration', async () => {
    const pending = deferredWorkspace()
    mocks.getSessionWorkspace.mockReturnValue(pending.promise)
    mocks.getPiBranchSummarySkipPrompt.mockResolvedValue(false)
    const params = workflowParams()
    render(<BranchButton params={params} />)
    clickBranch()
    await act(async () => pending.resolve(workspace()))
    expect(useSessionStore.getState().activeWorkspace).toBeNull()
    expect(useBranchSummaryStore.getState().prompt).toMatchObject({
      sessionId: SESSION_ID,
      sourceNodeId: SOURCE_ID,
      mode: 'choice',
      restoreSelection: { branchId: 'main', nodeId: 'main-continuation' },
      previousComposerText: 'Existing draft',
      draftComposerText: 'Branch from this user node',
    })
  })

  it('does not use a previous Session workspace with colliding node IDs', async () => {
    const stale = workspace(SessionId('other-session'))
    const pending = deferredWorkspace()
    mocks.getSessionWorkspace.mockReturnValue(pending.promise)
    const params = workflowParams(stale)
    render(<BranchButton params={params} />)
    clickBranch()
    expect(useSessionStore.getState().draftBranch).toBeNull()
    await act(async () => pending.resolve(workspace()))
    expectBranch(params)
  })

  it('refreshes canonical metadata when a live message precedes its workspace projection', async () => {
    const complete = workspace()
    const partial = {
      ...complete,
      tree: {
        ...complete.tree,
        nodes: complete.tree.nodes.filter((entry) => entry.id !== MESSAGE.id),
      },
      transcriptPath: complete.transcriptPath.filter((entry) => entry.node.id !== MESSAGE.id),
    }
    const pending = deferredWorkspace()
    mocks.getSessionWorkspace.mockReturnValue(pending.promise)
    const params = workflowParams(partial)
    render(<BranchButton params={params} />)
    clickBranch()
    expect(useSessionStore.getState().draftBranch).toBeNull()
    await act(async () => pending.resolve(complete))
    expectBranch(params)
  })

  it.each(['missing', 'wrong-session'] as const)(
    'preserves the draft when the resolved source is %s',
    async (result) => {
      mocks.getSessionWorkspace.mockResolvedValue(
        result === 'missing' ? null : workspace(SessionId('other-session')),
      )
      const params = workflowParams()
      render(<BranchButton params={params} />)
      await act(async () => clickBranch())
      expect(useSessionStore.getState().draftBranch).toBeNull()
      expect(useComposerStore.getState().input).toBe('Existing draft')
      expect(params.navigate).not.toHaveBeenCalled()
      expect(params.showToast).toHaveBeenCalledWith(
        'Branch source is not available yet. Wait for the transcript to finish loading and try again.',
      )
    },
  )

  it('ignores a pending action after navigation within the same Session', async () => {
    const pending = deferredWorkspace()
    mocks.getSessionWorkspace.mockReturnValue(pending.promise)
    const params = workflowParams()
    const view = render(<BranchButton params={params} />)
    clickBranch()
    mocks.href = '/sessions/session-1?node=other-node'
    view.rerender(<BranchButton params={params} />)
    await act(async () => pending.resolve(workspace()))
    expect(useSessionStore.getState().draftBranch).toBeNull()
    expect(useComposerStore.getState().input).toBe('Existing draft')
    expect(params.navigate).not.toHaveBeenCalled()
  })

  it('ignores a pending action after unmount', async () => {
    const pending = deferredWorkspace()
    mocks.getSessionWorkspace.mockReturnValue(pending.promise)
    const params = workflowParams()
    const view = render(<BranchButton params={params} />)
    clickBranch()
    view.unmount()
    await act(async () => pending.resolve(workspace()))
    expect(useSessionStore.getState().draftBranch).toBeNull()
    expect(params.navigate).not.toHaveBeenCalled()
  })

  it('preserves the draft and reports a failed source read', async () => {
    mocks.getSessionWorkspace.mockRejectedValue(new Error('Host unavailable'))
    const params = workflowParams()
    render(<BranchButton params={params} />)
    await act(async () => clickBranch())
    expect(useSessionStore.getState().draftBranch).toBeNull()
    expect(useComposerStore.getState().input).toBe('Existing draft')
    expect(params.navigate).not.toHaveBeenCalled()
    expect(params.showToast).toHaveBeenCalledWith('Failed to load branch source: Host unavailable')
  })

  it('does not invent a parent if the fresh workspace still lacks the canonical message', async () => {
    const empty = workspace()
    mocks.getSessionWorkspace.mockResolvedValue({
      ...empty,
      tree: { ...empty.tree, nodes: [] },
      transcriptPath: [],
    })
    const params = workflowParams()
    render(<BranchButton params={params} />)
    await act(async () => clickBranch())
    expect(useSessionStore.getState().draftBranch).toBeNull()
    expect(useComposerStore.getState().input).toBe('Existing draft')
    expect(params.navigate).not.toHaveBeenCalled()
    expect(params.showToast).toHaveBeenCalledOnce()
  })

  it('saves text typed during the read in the original draft context', async () => {
    const pending = deferredWorkspace()
    mocks.getSessionWorkspace.mockReturnValue(pending.promise)
    const params = workflowParams()
    useComposerStore.setState({ activeDraftContextKey: 'original-draft' })
    render(<BranchButton params={params} />)
    clickBranch()
    act(() => useComposerStore.getState().setInput('More typing while waiting'))
    await act(async () => pending.resolve(workspace()))
    expectBranch(params)
    expect(useComposerStore.getState().scopedDrafts['original-draft']?.input).toBe(
      'More typing while waiting',
    )
  })

  it('ignores a pending action once another Session becomes active', async () => {
    const pending = deferredWorkspace()
    mocks.getSessionWorkspace.mockReturnValue(pending.promise)
    const params = workflowParams()
    render(<BranchButton params={params} />)
    clickBranch()
    act(() => useChatStore.setState({ activeSessionId: SessionId('other-session') }))
    await act(async () => pending.resolve(workspace()))
    expect(useSessionStore.getState().draftBranch).toBeNull()
    expect(params.navigate).not.toHaveBeenCalled()
  })

  it('applies only the latest click when source reads complete out of order', async () => {
    const first = deferredWorkspace()
    const second = deferredWorkspace()
    mocks.getSessionWorkspace.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const params = workflowParams()
    render(<BranchButton params={params} />)
    clickBranch()
    clickBranch()
    await act(async () => second.resolve(workspace()))
    expectBranch(params)
    await act(async () => first.resolve(workspace()))
    expect(params.navigate).toHaveBeenCalledOnce()
  })

  it('preserves a different draft branch selected while the workspace read is pending', async () => {
    const pending = deferredWorkspace()
    mocks.getSessionWorkspace.mockReturnValue(pending.promise)
    const params = workflowParams()
    render(<BranchButton params={params} />)
    clickBranch()
    const otherDraft = { sessionId: SESSION_ID, sourceNodeId: SessionNodeId('other-source') }
    act(() => useSessionStore.getState().setDraftBranch(otherDraft))
    await act(async () => pending.resolve(workspace()))
    expect(useSessionStore.getState().draftBranch).toEqual(otherDraft)
    expect(params.navigate).not.toHaveBeenCalled()
  })
})
