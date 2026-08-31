import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from '@/features/providers/state'
import { useSessionSummaryUIStore } from '@/features/session-summary'
import { usePreferencesStore } from '@/features/settings/state'
import type { ChatPanelSections } from '../../model'
import { ChatPanel } from '../ChatPanel'
import { createSections, makeMessage } from './ChatPanel.test-utils'

const useChatPanelSectionsMock = vi.hoisted(() => vi.fn<() => ChatPanelSections>())
let notifyResize = () => {}

class TestResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    notifyResize = () => callback([], this)
  }

  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): ResizeObserverEntry[] {
    return []
  }
}

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

const SESSION: SessionDetail = {
  id: SessionId('session-1'),
  title: 'Session one',
  projectPath: '/test/project',
  messages: [],
  createdAt: 1,
  updatedAt: 1,
}

function renderPanel(
  overrides: Partial<ChatPanelSections['transcript']> = {},
  composerOverrides: Partial<ChatPanelSections['composer']> = {},
) {
  useChatPanelSectionsMock.mockReturnValue(createSections(overrides, composerOverrides))
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatPanel />
    </QueryClientProvider>,
  )
}

describe('ChatPanel session summary and setup dock', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    localStorage.clear()
    useSessionSummaryUIStore.setState({ panels: {} })
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: {
        ...DEFAULT_SETTINGS,
        projectPath: '/test/project',
        selectedModel: SupportedModelId('openai/gpt-5'),
      },
      isLoaded: true,
    })
    useProviderStore.setState({ ...useProviderStore.getInitialState(), providerModels: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not show an empty summary for auxiliary rows before the first sent message', () => {
    renderPanel(
      { chatRows: [{ type: 'phase-indicator', label: 'Thinking', elapsedMs: 123 }] },
      { isFirstMessage: true, session: SESSION },
    )
    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
  })

  it('keeps the transcript width independent from the floating Session Summary', () => {
    const message = makeMessage({
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', content: 'Hello agent' }],
    })
    renderPanel(
      {
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
      },
      { isFirstMessage: false, session: SESSION },
    )
    expect(screen.getByRole('log', { name: 'Chat messages' })).not.toHaveClass('pr-84')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Session Summary' }))
    expect(screen.getByRole('log', { name: 'Chat messages' })).not.toHaveClass('pr-84')
    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
  })

  it('automatically hides the panel in a narrow chat while keeping its toggle usable', () => {
    const message = makeMessage({
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', content: 'Hello agent' }],
    })
    renderPanel(
      {
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
      },
      { isFirstMessage: false, session: SESSION },
    )
    const chatPanel = document.querySelector('[data-chat-panel-main="true"]')
    if (!(chatPanel instanceof HTMLElement)) throw new Error('Chat panel main element is missing.')
    Object.defineProperty(chatPanel, 'clientWidth', { configurable: true, value: 700 })

    act(() => notifyResize())

    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
    act(() => useSessionSummaryUIStore.getState().togglePanel('session-1'))
    expect(screen.getByRole('complementary', { name: 'Session Summary' })).toBeInTheDocument()
  })

  it('hides before paint when the chat mounts below the automatic summary width', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(700)
    const message = makeMessage({
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', content: 'Hello agent' }],
    })

    renderPanel(
      {
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
      },
      { isFirstMessage: false, session: SESSION },
    )

    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
  })

  it('shows the session setup dock before the first message', () => {
    renderPanel({}, { isFirstMessage: true })
    expect(screen.getByRole('group', { name: 'Session setup' })).toBeInTheDocument()
  })

  it('opens project selection from the session setup dock', () => {
    renderPanel(
      { recentProjects: ['/test/other-project'] },
      { isFirstMessage: true, projectPath: '/test/project' },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Project: project' }))
    expect(screen.getByRole('dialog')).toHaveClass('mb-3')
    expect(screen.getByRole('searchbox', { name: 'Search projects' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select folder…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'other-project' })).toBeInTheDocument()
  })

  it('starts a draft in a recent project selected from the dock', () => {
    const onSelectProjectPath = vi.fn()
    renderPanel(
      { recentProjects: ['/test/other-project'], onSelectProjectPath },
      { isFirstMessage: true, projectPath: '/test/project' },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Project: project' }))
    fireEvent.click(screen.getByRole('button', { name: 'other-project' }))
    expect(onSelectProjectPath).toHaveBeenCalledWith('/test/other-project')
  })

  it('opens the operating-system folder chooser from the dock project menu', () => {
    const onOpenProject = vi.fn().mockResolvedValue(undefined)
    renderPanel({ onOpenProject }, { isFirstMessage: true, projectPath: '/test/project' })
    fireEvent.click(screen.getByRole('button', { name: 'Project: project' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select folder…' }))
    expect(onOpenProject).toHaveBeenCalledOnce()
  })

  it('uses the dialog radius for both the composer and its dock', () => {
    renderPanel({}, { isFirstMessage: true, projectPath: '/test/project' })
    const composer = screen.getByRole('region', { name: 'Composer file drop zone' })
    const projectTrigger = screen.getByRole('button', { name: 'Project: project' })
    expect(composer).toHaveClass('rounded-xl')
    expect(composer).not.toHaveClass('rounded-3xl')
    expect(projectTrigger.closest('.rounded-t-xl')).toBeInTheDocument()
  })

  it('hides the session setup dock after the first message or while submitting it', () => {
    const { rerender } = renderPanel({}, { isFirstMessage: false })
    expect(screen.queryByRole('group', { name: 'Session setup' })).not.toBeInTheDocument()
    useChatPanelSectionsMock.mockReturnValue(
      createSections({}, { isFirstMessage: true, isLoading: true, status: 'submitted' }),
    )
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ChatPanel />
      </QueryClientProvider>,
    )
    expect(screen.queryByRole('group', { name: 'Session setup' })).not.toBeInTheDocument()
  })
})
