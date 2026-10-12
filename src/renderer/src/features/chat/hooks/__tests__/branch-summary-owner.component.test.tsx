import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BranchSummaryPrompt } from '@/features/composer/components'
import { buildComposerDraftContextKey } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import { UserMessageBubble } from '../../components/UserMessageBubble'
import { useBranchSummaryStore } from '../../state/branch-summary-store'
import { useChatStore } from '../../state/chat-store'
import { useBranchFromMessage } from '../useBranchFromMessage'
import { useBranchSummaryWorkflow } from '../useBranchSummaryWorkflow'
import {
  MESSAGE,
  SESSION_ID,
  SOURCE_ID,
  workflowParams,
  workspace,
} from './branch-from-message.test-utils'

const mocks = vi.hoisted(() => ({
  getSessionWorkspace: vi.fn(),
  getPiBranchSummarySkipPrompt: vi.fn(),
  navigateSessionTree: vi.fn(),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: mocks }))
vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => '/sessions/session-1',
  useSearch: () => ({}),
}))
vi.mock('@/features/workspace-files/hooks', () => ({ useOpenWorkspaceFile: () => vi.fn() }))

function BranchActions({ params }: { readonly params: ReturnType<typeof workflowParams> }) {
  const summary = useBranchSummaryWorkflow(params)
  const onBranchFromMessage = useBranchFromMessage({
    ...params,
    messages: [MESSAGE],
    switchComposerToDraftBranch: summary.switchComposerToDraftBranch,
  })
  return (
    <>
      <UserMessageBubble message={MESSAGE} onBranchFromMessage={onBranchFromMessage} />
      <BranchSummaryPrompt
        onNoSummary={summary.skipBranchSummary}
        onSummarize={() => void summary.materializeBranchSummary()}
        onCustomSummary={summary.startCustomBranchSummary}
        onCancel={summary.cancelBranchSummary}
      />
    </>
  )
}

function ownedWorkspace(projectPath: string | null): SessionWorkspace {
  const source = workspace()
  return { ...source, tree: { ...source.tree, session: { ...source.tree.session, projectPath } } }
}

function sourceDraftKey(projectPath: string | null) {
  return buildComposerDraftContextKey({
    projectPath,
    sessionId: SESSION_ID,
    draftSourceNodeId: SOURCE_ID,
  })
}

function pendingNavigation() {
  let resolve: () => void = () => {
    throw new Error('Promise not initialized')
  }
  const promise = new Promise<{ cancelled: boolean }>((finish) => {
    resolve = () => finish({ cancelled: false })
  })
  return { promise, resolve }
}

async function openBeforeNormalHydration(
  params: ReturnType<typeof workflowParams>,
  source: SessionWorkspace,
) {
  mocks.getSessionWorkspace.mockResolvedValue(source)
  render(<BranchActions params={params} />)
  await act(async () => {
    fireEvent.click(screen.getByTitle('Branch from message'))
  })
  expect(screen.getByRole('button', { name: 'Summarize' })).toBeVisible()
  expect(useSessionStore.getState().activeWorkspace).toBeNull()
  expect(useComposerStore.getState().input).toBe('Branch from this user node')
}

describe('canonical branch-summary prompt ownership before normal hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPiBranchSummarySkipPrompt.mockResolvedValue(false)
    mocks.navigateSessionTree.mockResolvedValue({ cancelled: false })
    useChatStore.setState({ activeSessionId: SESSION_ID })
    useSessionStore.setState({ activeWorkspace: null, draftBranch: null })
    useBranchSummaryStore.getState().clearPrompt()
    useComposerStore.setState({
      activeDraftContextKey: null,
      input: 'Original draft',
      attachments: [],
      lexicalEditor: null,
      scopedDrafts: {},
    })
  })

  it.each(['/repo', null])(
    'cancels immediately using the captured %s owner, not global preferences',
    async (projectPath) => {
      const source = ownedWorkspace(projectPath)
      const params = { ...workflowParams(), projectPath: '/previous-project' }
      await openBeforeNormalHydration(params, source)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      })

      expect(useComposerStore.getState().input).toBe('Original draft')
      expect(useComposerStore.getState().activeDraftContextKey).toBe(
        buildComposerDraftContextKey({
          projectPath,
          sessionId: SESSION_ID,
          activeBranchId: source.activeBranchId,
          activeNodeId: source.activeNodeId,
        }),
      )
      expect(useComposerStore.getState().getScopedDraft(sourceDraftKey(projectPath))).toBeNull()
      expect(useBranchSummaryStore.getState().prompt).toBeNull()
      expect(mocks.getPiBranchSummarySkipPrompt).toHaveBeenCalledWith(projectPath)
    },
  )

  it.each([
    { projectPath: '/repo', hydration: 'before-navigation-result' },
    { projectPath: null, hydration: 'before-navigation-result' },
    { projectPath: '/repo', hydration: 'during-final-refresh' },
    { projectPath: null, hydration: 'during-final-refresh' },
  ])(
    'summarizes with captured $projectPath ownership when hydration arrives $hydration',
    async ({ projectPath, hydration }) => {
      const source = ownedWorkspace(projectPath)
      const target = {
        ...source,
        activeBranchId: SessionBranchId('summary-branch'),
        activeNodeId: SessionNodeId('summary-node'),
      }
      const refreshSessionWorkspace = vi.fn<
        ReturnType<typeof workflowParams>['refreshSessionWorkspace']
      >(async (_sessionId, selection) => {
        if (selection === undefined) useSessionStore.setState({ activeWorkspace: target })
      })
      const params: ReturnType<typeof workflowParams> = {
        ...workflowParams(),
        projectPath: '/previous-project',
        refreshSessionWorkspace,
      }
      mocks.navigateSessionTree.mockImplementation(async () => {
        if (hydration === 'before-navigation-result')
          useSessionStore.setState({ activeWorkspace: source })
        return { cancelled: false }
      })
      await openBeforeNormalHydration(params, source)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))
      })

      expect(useBranchSummaryStore.getState().prompt).toBeNull()
      expect(useComposerStore.getState().activeDraftContextKey).toBe(
        buildComposerDraftContextKey({
          projectPath,
          sessionId: SESSION_ID,
          activeBranchId: target.activeBranchId,
          activeNodeId: target.activeNodeId,
        }),
      )
      expect(useComposerStore.getState().getScopedDraft(sourceDraftKey(projectPath))).toBeNull()
      expect(useComposerStore.getState().input).toBe('Branch from this user node')
      expect(mocks.getPiBranchSummarySkipPrompt).toHaveBeenCalledWith(projectPath)
    },
  )

  it('ignores a completed request after the identical prompt is reopened and summarized again', async () => {
    const first = pendingNavigation()
    const second = pendingNavigation()
    mocks.navigateSessionTree.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const source = ownedWorkspace('/repo')
    const params = workflowParams()
    useComposerStore.getState().setInput('Branch from this user node')
    await openBeforeNormalHydration(params, source)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByTitle('Branch from message'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))
    })
    const currentPrompt = useBranchSummaryStore.getState().prompt

    await act(async () => first.resolve())

    expect(useBranchSummaryStore.getState().prompt).toBe(currentPrompt)
    expect(currentPrompt?.mode).toBe('summarizing')
    await act(async () => second.resolve())
  })

  it('preserves a newer same-Session draft and prompt while the completed summary refresh is pending', async () => {
    const refresh = pendingNavigation()
    const source = ownedWorkspace('/repo')
    const params: ReturnType<typeof workflowParams> = {
      ...workflowParams(),
      refreshSessionWorkspace: vi.fn(async (_sessionId, selection) => {
        if (selection !== undefined) return
        await refresh.promise
        useSessionStore.setState({ activeWorkspace: source })
      }),
    }
    await openBeforeNormalHydration(params, source)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))
    })
    expect(params.refreshSessionWorkspace).toHaveBeenCalledWith(SESSION_ID)
    await act(async () => {
      fireEvent.click(screen.getByTitle('Branch from message'))
    })
    const newPrompt = useBranchSummaryStore.getState().prompt
    const newDraft = useSessionStore.getState().draftBranch
    act(() => useComposerStore.getState().setInput('New draft typed during refresh'))
    vi.mocked(params.navigate).mockClear()

    await act(async () => refresh.resolve())

    expect(useComposerStore.getState().input).toBe('New draft typed during refresh')
    expect(useComposerStore.getState().activeDraftContextKey).toBe(sourceDraftKey('/repo'))
    expect(useBranchSummaryStore.getState().prompt).toBe(newPrompt)
    expect(useSessionStore.getState().draftBranch).toBe(newDraft)
    expect(params.clearDraftBranchForSession).not.toHaveBeenCalled()
    expect(params.navigate).not.toHaveBeenCalled()
  })

  it('does not apply another Session workspace returned by the final refresh', async () => {
    const source = ownedWorkspace('/repo')
    const params: ReturnType<typeof workflowParams> = {
      ...workflowParams(),
      refreshSessionWorkspace: vi.fn(async (_sessionId, selection) => {
        if (selection === undefined)
          useSessionStore.setState({ activeWorkspace: workspace(SessionId('other-session')) })
      }),
    }
    await openBeforeNormalHydration(params, source)
    vi.mocked(params.navigate).mockClear()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))
    })

    expect(useComposerStore.getState().activeDraftContextKey).toBe(sourceDraftKey('/repo'))
    expect(useBranchSummaryStore.getState().prompt?.mode).toBe('choice')
    expect(params.clearDraftBranchForSession).not.toHaveBeenCalled()
    expect(params.navigate).not.toHaveBeenCalled()
    expect(params.showToast).toHaveBeenCalled()
  })

  it('ignores the older preference lookup after the same branch is reopened and summarizing', async () => {
    const preference = pendingNavigation()
    const navigation = pendingNavigation()
    mocks.getPiBranchSummarySkipPrompt
      .mockReturnValueOnce(preference.promise.then(() => false))
      .mockResolvedValueOnce(false)
    mocks.navigateSessionTree.mockReturnValue(navigation.promise)
    mocks.getSessionWorkspace.mockResolvedValue(ownedWorkspace('/repo'))
    render(<BranchActions params={workflowParams()} />)
    await act(async () => {
      fireEvent.click(screen.getByTitle('Branch from message'))
    })
    await act(async () => {
      fireEvent.click(screen.getByTitle('Branch from message'))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Summarize' }))
    })
    const currentPrompt = useBranchSummaryStore.getState().prompt

    await act(async () => preference.resolve())

    expect(useBranchSummaryStore.getState().prompt).toBe(currentPrompt)
    expect(currentPrompt?.mode).toBe('summarizing')
    await act(async () => navigation.resolve())
  })
})
