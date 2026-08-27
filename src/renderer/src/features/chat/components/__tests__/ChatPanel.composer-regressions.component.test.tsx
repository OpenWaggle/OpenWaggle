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
