import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageQueueStore } from '@/features/chat/state'
import { useBranchSummaryStore } from '@/features/chat/state/branch-summary-store'
import { useComposerStore } from '@/features/composer/state'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import type { AgentInteractionEvent, ChatRow } from '../../lib/types-chat-row'
import { ChatPanelContent } from '../ChatPanel'
import { createSections, makeMessage } from './ChatPanel.test-utils'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getProviderModels: vi.fn().mockResolvedValue([]),
    getGitStatus: vi.fn().mockResolvedValue(null),
    listGitBranches: vi.fn().mockResolvedValue({ currentBranch: 'main', branches: [] }),
    listChangeRequests: vi.fn().mockResolvedValue({ ok: true, changeRequests: [] }),
    checkSessionWorktree: vi.fn().mockResolvedValue({ exists: false }),
    onGitWorkingTreeChanged: vi.fn(() => () => undefined),
    setSessionWorktreePlan: vi.fn().mockResolvedValue(undefined),
    createGitWorktree: vi.fn().mockResolvedValue({ ok: true, message: 'Created' }),
    checkoutGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'Checked out' }),
    prepareAttachments: vi.fn().mockResolvedValue([]),
    onWaggleEvent: vi.fn(() => () => undefined),
    onWaggleTurnEvent: vi.fn(() => () => undefined),
  },
}))

function renderSections(sections = createSections()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatPanelContent sections={sections} />
    </QueryClientProvider>,
  )
}

describe('ChatPanel composer regressions', () => {
  beforeEach(() => {
    useBranchSummaryStore.setState(useBranchSummaryStore.getInitialState())
    useComposerStore.setState(useComposerStore.getInitialState())
    useMessageQueueStore.setState({ queues: new Map() })
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: {
        ...DEFAULT_SETTINGS,
        projectPath: '/test/project',
        selectedModel: SupportedModelId('openai/gpt-5'),
      },
      isLoaded: true,
    })
    useProviderStore.setState({
      ...useProviderStore.getInitialState(),
      providerModels: [],
    })
  })

  it('keeps the extension run-status host mounted after the setup dock hides', () => {
    renderSections(
      createSections({}, { isFirstMessage: true, isLoading: true, status: 'submitted' }),
    )

    expect(screen.queryByRole('group', { name: 'Session setup' })).not.toBeInTheDocument()
    expect(document.querySelector('[data-extension-run-status-host="true"]')).toBeInTheDocument()
  })

  it('shows active compaction in the transcript instead of docking it to the composer', () => {
    renderSections(
      createSections(
        {
          chatRows: [
            {
              type: 'compaction-status',
              id: 'compaction-1',
              anchorMessageCount: 0,
              announce: true,
              state: 'automatic-running',
            },
          ],
          isLoading: true,
        },
        {
          isLoading: true,
          status: 'compacting',
          compactionStatus: {
            type: 'compacting',
            reason: 'threshold',
            summaryCountAtStart: 0,
            timeline: [],
          },
        },
      ),
    )

    expect(screen.getAllByText('Context automatically compacting')).toHaveLength(2)
    expect(screen.queryByText('Auto-compacting…')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel compaction' })).not.toBeInTheDocument()
  })

  it('does not announce an earlier completion after a later compaction fails', () => {
    renderSections(
      createSections({
        chatRows: [
          {
            type: 'compaction-status',
            id: 'earlier-compaction',
            anchorMessageCount: 0,
            announce: false,
            state: 'automatic-complete',
          },
        ],
      }),
    )

    expect(screen.getAllByText('Context automatically compacted')).toHaveLength(1)
    expect(
      screen.queryByText('Context automatically compacted', { selector: '.sr-only' }),
    ).not.toBeInTheDocument()
  })

  it('keeps hydrated compaction history accessible without announcing it as new activity', () => {
    renderSections(
      createSections({
        chatRows: [
          {
            type: 'compaction-summary',
            id: 'summary-1',
            summary: 'Preserved context',
            tokensBefore: 100,
            reason: 'threshold',
          },
        ],
      }),
    )

    expect(
      screen.queryByText('Context automatically compacted', { selector: '.sr-only' }),
    ).not.toBeInTheDocument()
    const durableLabel = screen
      .getAllByText('Context automatically compacted')
      .find((element) => !element.closest('.sr-only'))
    expect(durableLabel?.closest('div')).not.toHaveAttribute('aria-hidden')
  })

  it('brings the setup dock back when an established session worktree is missing', async () => {
    const session = fromPartial<SessionDetail>({
      id: SessionId('session-1'),
      projectPath: '/test/project',
      environmentMode: 'worktree',
      worktreePath: '/test/project/.openwaggle/session-1',
      worktreeBaseRef: 'main',
      worktreeStartFromOrigin: false,
      messages: [{ id: 'existing-turn' }],
    })
    renderSections(createSections({}, { isFirstMessage: false, session }))

    expect(await screen.findByText(/This session's worktree no longer exists/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recreate worktree' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use current checkout' })).toBeInTheDocument()
  })

  it('keeps every setup decision inside a responsive dock column', () => {
    renderSections(createSections({}, { isFirstMessage: true, projectPath: '/test/project' }))

    const projectTrigger = screen.getByRole('button', { name: 'Project: project' })
    const environmentTrigger = screen.getByRole('button', {
      name: 'Session environment mode: Current checkout',
    })
    const branchTrigger = screen.getByRole('button', { name: 'Run target: branch' })

    expect(projectTrigger.closest('.rounded-t-xl')).toHaveClass('@container/session-dock')
    expect(screen.getByTestId('session-setup-dock-row')).toHaveClass(
      'grid',
      'min-w-0',
      'grid-cols-[auto_auto_auto_auto_minmax(0,1fr)]',
    )
    expect(screen.getByTestId('session-setup-dock-row')).not.toHaveClass('overflow-hidden')
    expect(screen.getByTestId('session-setup-branch')).toHaveClass('min-w-0')
    expect(projectTrigger).toHaveClass('max-w-full')
    expect(environmentTrigger).toHaveClass('max-w-full')
    expect(branchTrigger).toHaveClass('max-w-full')
    expect(projectTrigger.querySelector('span')).toHaveClass('@max-xl/session-dock:max-w-24')
    expect(environmentTrigger.querySelector('span')).toHaveClass('@max-xl/session-dock:hidden')
    expect(environmentTrigger).toHaveAttribute('title', 'Current checkout')
  })

  it('formats ordinary active-project paths in composer-adjacent notifications', () => {
    const event = fromPartial<AgentInteractionEvent>({
      type: 'agent_interaction_request',
      timestamp: 1,
      interaction: {
        interactionId: 'notify-1',
        kind: 'notify',
        level: 'warning',
        message: 'Could not read /test/project/src/main.ts',
      },
    })
    renderSections({ ...createSections(), agentInteractionEvents: [event] })

    expect(screen.getAllByText('Could not read src/main.ts')).toHaveLength(2)
    expect(screen.queryByText(/\/test\/project\/src\/main\.ts/)).toBeNull()
  })

  it('aligns standard and Waggle transcript rows with the composer frame', () => {
    const userMessage = makeMessage({
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', content: 'Start the review' }],
    })
    const waggleMessage = makeMessage({
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Waggle review complete' }],
    })
    const chatRows: ChatRow[] = [
      {
        type: 'message',
        message: userMessage,
        isStreaming: false,
        isRunActive: false,
        showTurnDivider: false,
      },
      {
        type: 'waggle-turn',
        id: 'waggle-turn:session-1:0',
        agentColor: 'blue',
        turnDividerProps: {
          turnNumber: 0,
          agentLabel: 'Reviewer',
          agentColor: 'blue',
          agentModel: SupportedModelId('openai/gpt-5'),
        },
        messages: [
          {
            type: 'message',
            message: waggleMessage,
            isStreaming: false,
            isRunActive: false,
            showTurnDivider: false,
            waggle: { agentLabel: 'Reviewer', agentColor: 'blue' },
          },
        ],
      },
    ]

    renderSections(createSections({ messages: [userMessage, waggleMessage], chatRows }))

    const composerFrame = document.querySelector('[data-chat-composer-form="true"]')
    const transcriptFrames = document.querySelectorAll('[data-chat-content-frame="transcript-row"]')

    expect(composerFrame).toHaveClass('max-w-180', 'px-5')
    expect(transcriptFrames).toHaveLength(2)
    for (const frame of transcriptFrames) {
      expect(frame).toHaveClass('max-w-180', 'px-5')
      expect(frame).not.toHaveClass('px-12')
    }
    expect(document.querySelector('[data-waggle-turn]')).toBeInTheDocument()
    expect(screen.getByText('Waggle review complete')).toBeInTheDocument()
  })
})
