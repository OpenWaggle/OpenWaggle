import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBranchSummaryStore } from '../../../stores/branch-summary-store'
import { useComposerStore } from '../../../stores/composer-store'
import { useMessageQueueStore } from '../../../stores/message-queue-store'
import { usePreferencesStore } from '../../../stores/preferences-store'
import { useProviderStore } from '../../../stores/provider-store'
import { ChatPanel } from '../ChatPanel'
import type { ChatPanelSections } from '../use-chat-panel-controller'

const useChatPanelSectionsMock = vi.hoisted(() => vi.fn<() => ChatPanelSections>())

vi.mock('../use-chat-panel-controller', () => ({
  useChatPanelSections: useChatPanelSectionsMock,
}))

vi.mock('@/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getProviderModels: vi.fn().mockResolvedValue([]),
    getGitStatus: vi.fn().mockResolvedValue(null),
    listGitBranches: vi.fn().mockResolvedValue(null),
    checkoutGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    createGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    renameGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    deleteGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    setGitBranchUpstream: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    prepareAttachments: vi.fn().mockResolvedValue([]),
  },
}))

function makeMessage(
  overrides: Partial<UIMessage> & { id: string; role: 'user' | 'assistant' },
): UIMessage {
  return {
    parts: [],
    ...overrides,
  } as UIMessage
}

function createSections(
  overrides: Partial<ChatPanelSections['transcript']> = {},
  composerOverrides: Partial<ChatPanelSections['composer']> = {},
): ChatPanelSections {
  const transcript = {
    messages: [],
    isLoading: false,
    projectPath: '/test/project',
    recentProjects: [],
    activeSessionId: SessionId('session-1'),
    chatRows: [],
    lastUserMessageId: null,
    streamSignalVersion: 0,
    userDidSend: false,
    onUserDidSendConsumed: vi.fn(),
    onOpenProject: vi.fn().mockResolvedValue(undefined),
    onSelectProjectPath: vi.fn(),
    onRetryText: vi.fn().mockResolvedValue(undefined),
    onOpenSettings: vi.fn(),
    onDismissError: vi.fn(),
    onDismissInterruptedRun: vi.fn(),
    onBranchFromMessage: vi.fn(),
    onForkFromMessage: vi.fn(),
    ...overrides,
  }

  return {
    transcript,
    composer: {
      activeSessionId: transcript.activeSessionId,
      waggleStatus: 'idle',
      commandPaletteOpen: false,
      slashSkills: [],
      forkSelectorOpen: false,
      forkTargets: [],
      isLoading: transcript.isLoading,
      status: transcript.isLoading ? 'streaming' : 'ready',
      compactionStatus: null,
      onStopCollaboration: vi.fn(),
      onSelectSkill: vi.fn(),
      onStartWaggle: vi.fn(),
      onSendWithWaggle: vi.fn().mockResolvedValue(undefined),
      onSteer: vi.fn().mockResolvedValue(undefined),
      onCancel: vi.fn(),
      onToast: vi.fn(),
      onSkipBranchSummary: vi.fn(),
      onSummarizeBranch: vi.fn(),
      onStartCustomBranchSummary: vi.fn(),
      onCancelBranchSummary: vi.fn(),
      onOpenForkSelector: vi.fn(),
      onCloseForkSelector: vi.fn(),
      onSelectForkTarget: vi.fn(),
      onCloneToNewSession: vi.fn(),
      ...composerOverrides,
    },
    diff: {
      projectPath: transcript.projectPath,
      onSendMessage: transcript.onRetryText,
    },
  }
}

function renderPanel(
  overrides: Partial<ChatPanelSections['transcript']> = {},
  composerOverrides: Partial<ChatPanelSections['composer']> = {},
) {
  useChatPanelSectionsMock.mockReturnValue(createSections(overrides, composerOverrides))
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatPanel />
    </QueryClientProvider>,
  )
}

describe('ChatPanel', () => {
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

  it('shows welcome screen when no messages', () => {
    renderPanel()
    expect(screen.getByText("Let's build")).toBeInTheDocument()
    expect(screen.queryByText('Explore more')).toBeNull()
  })

  it('renders the welcome heading smaller and lighter than the project name', () => {
    renderPanel()

    const heading = screen.getByRole('heading', { name: "Let's build" })
    const projectPickerButton = screen.getByTitle('Open project picker')

    expect(heading).toHaveClass('font-normal')
    expect(heading).not.toHaveClass('font-semibold')
    expect(projectPickerButton).toHaveClass('text-[clamp(28px,3.8vw,40px)]', 'font-light')
  })

  it('opens the folder picker directly from the empty-state CTA', () => {
    const onOpenProject = vi.fn().mockResolvedValue(undefined)
    renderPanel({
      projectPath: null,
      recentProjects: ['/test/other-project'],
      onOpenProject,
    })

    fireEvent.click(screen.getByRole('button', { name: /select a project folder to get started/i }))

    expect(onOpenProject).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Select folder…')).toBeNull()
  })

  it('keeps the active-project menu available when a project is already selected', () => {
    renderPanel({
      recentProjects: ['/test/other-project'],
    })

    fireEvent.click(screen.getByTitle('Open project picker'))

    expect(screen.getByText('Select folder…')).toBeInTheDocument()
    expect(screen.getByText('Recent projects')).toBeInTheDocument()
  })

  it('shows thinking phase indicator when loading with no assistant message', () => {
    renderPanel({
      isLoading: true,
      chatRows: [{ type: 'phase-indicator', label: 'Thinking', elapsedMs: 123 }],
    })
    const spinner = document.querySelector('[class*="animate-spin"]')
    expect(spinner).toBeInTheDocument()
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })

  it('renders messages when present', () => {
    const message = makeMessage({
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', content: 'Hello agent' }],
    })
    renderPanel({
      messages: [message],
      chatRows: [{ type: 'message', message, isStreaming: false, showTurnDivider: false }],
    })
    expect(screen.queryByText(/open a project/i)).toBeNull()
  })

  it('routes custom branch-summary submission through send instead of enqueue while loading', () => {
    const onSendWithWaggle = vi.fn().mockResolvedValue(undefined)
    useBranchSummaryStore.getState().openPrompt({
      sessionId: SessionId('session-1'),
      sourceNodeId: SessionNodeId('source-node'),
      restoreSelection: { branchId: null, nodeId: null },
      previousComposerText: 'original prompt',
      draftComposerText: 'draft prompt',
    })
    useBranchSummaryStore.getState().startCustomPrompt('draft prompt')
    useComposerStore.getState().setInput('focus on decisions')

    renderPanel(
      { isLoading: true },
      {
        isLoading: true,
        status: 'streaming',
        onSendWithWaggle,
      },
    )

    fireEvent.click(screen.getByTitle('Summarize branch'))

    expect(onSendWithWaggle).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'focus on decisions' }),
    )
    expect(useMessageQueueStore.getState().queues.get(SessionId('session-1'))).toBeUndefined()
  })

  it('renders the composer input area', () => {
    renderPanel()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('shows Writing phase when loading and assistant has streaming content', () => {
    const userMessage = makeMessage({
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', content: 'Hi' }],
    })
    const assistantMessage = makeMessage({
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Hello!' }],
    })
    renderPanel({
      messages: [userMessage, assistantMessage],
      isLoading: true,
      chatRows: [
        { type: 'message', message: userMessage, isStreaming: false, showTurnDivider: false },
        { type: 'message', message: assistantMessage, isStreaming: true, showTurnDivider: false },
        { type: 'phase-indicator', label: 'Writing', elapsedMs: 456 },
      ],
    })
    const spinner = document.querySelector('[class*="animate-spin"]')
    expect(spinner).toBeInTheDocument()
    expect(screen.getByText('Writing...')).toBeInTheDocument()
  })

  it('does not show phase indicator when not loading', () => {
    const userMessage = makeMessage({
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', content: 'Hi' }],
    })
    const assistantMessage = makeMessage({
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Hello!' }],
    })
    renderPanel({
      messages: [userMessage, assistantMessage],
      isLoading: false,
      chatRows: [
        { type: 'message', message: userMessage, isStreaming: false, showTurnDivider: false },
        { type: 'message', message: assistantMessage, isStreaming: false, showTurnDivider: false },
      ],
    })
    const spinner = document.querySelector('[class*="animate-spin"]')
    expect(spinner).toBeNull()
  })
})
