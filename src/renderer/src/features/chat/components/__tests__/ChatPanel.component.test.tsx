import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageQueueStore } from '@/features/chat/state'
import { useBranchSummaryStore } from '@/features/chat/state/branch-summary-store'
import { useComposerStore } from '@/features/composer/state'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import type { ChatPanelSections } from '../../model'
import { ChatPanel } from '../ChatPanel'
import { createSections, makeMessage } from './ChatPanel.test-utils'

const useChatPanelSectionsMock = vi.hoisted(() => vi.fn<() => ChatPanelSections>())

vi.mock('../../hooks/use-chat-panel-controller', () => ({
  useChatPanelSections: useChatPanelSectionsMock,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getProviderModels: vi.fn().mockResolvedValue([]),
    getGitStatus: vi.fn().mockResolvedValue(null),
    listGitBranches: vi.fn().mockResolvedValue({ currentBranch: 'main', branches: [] }),
    checkoutGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    createGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    prepareAttachments: vi.fn().mockResolvedValue([]),
    onWaggleEvent: vi.fn(() => () => undefined),
    onWaggleTurnEvent: vi.fn(() => () => undefined),
    listSessionResources: vi.fn().mockResolvedValue([]),
    listArchivedSessions: vi.fn().mockResolvedValue([]),
    onRunCompleted: vi.fn(() => () => undefined),
    getVcsStatus: vi.fn().mockResolvedValue(null),
    onGitWorkingTreeChanged: vi.fn(() => () => undefined),
  },
}))

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
    localStorage.clear()
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
    expect(screen.queryByText('Build a coding game in this repo')).not.toBeInTheDocument()
    expect(screen.queryByText('Draft a one-page summary of this app')).not.toBeInTheDocument()
    expect(screen.queryByText('Create a refactor plan for this codebase')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Welcome' })).toHaveClass(
      'flex-1',
      'items-center',
      'justify-center',
    )
  })

  it('renders the welcome heading and project name with standard type steps', () => {
    renderPanel()

    const heading = screen.getByRole('heading', { name: "Let's build" })
    const projectPickerButton = screen.getByTitle('Open project picker')

    expect(heading).toHaveClass('text-2xl', 'font-normal')
    expect(heading).toHaveClass('whitespace-nowrap')
    expect(heading.parentElement).toHaveClass('flex', 'items-center', 'gap-2')
    expect(heading).not.toHaveClass('font-semibold')
    expect(projectPickerButton).toHaveClass('gap-1.5', 'text-2xl', 'font-light')
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
      chatRows: [
        {
          type: 'message',
          message,
          isStreaming: false,
          isRunActive: false,
          showTurnDivider: false,
        },
      ],
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

  it('focuses the message input from non-interactive composer chrome', async () => {
    renderPanel()
    const composer = screen.getByRole('region', { name: 'Composer file drop zone' })
    const messageInput = screen.getByRole('textbox', { name: 'Message input' })
    const addButton = screen.getByRole('button', { name: 'Add to message' })

    addButton.focus()
    expect(addButton).toHaveFocus()

    fireEvent.mouseDown(composer)

    await waitFor(() => expect(messageInput).toHaveFocus())
    expect(composer).toHaveClass('cursor-text', '[&_button]:cursor-default')

    addButton.focus()
    fireEvent.mouseDown(addButton)
    expect(addButton).toHaveFocus()
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
        {
          type: 'message',
          message: userMessage,
          isStreaming: false,
          isRunActive: false,
          showTurnDivider: false,
        },
        {
          type: 'message',
          message: assistantMessage,
          isStreaming: true,
          isRunActive: false,
          showTurnDivider: false,
        },
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
        {
          type: 'message',
          message: userMessage,
          isStreaming: false,
          isRunActive: false,
          showTurnDivider: false,
        },
        {
          type: 'message',
          message: assistantMessage,
          isStreaming: false,
          isRunActive: false,
          showTurnDivider: false,
        },
      ],
    })
    const spinner = document.querySelector('[class*="animate-spin"]')
    expect(spinner).toBeNull()
  })
})
