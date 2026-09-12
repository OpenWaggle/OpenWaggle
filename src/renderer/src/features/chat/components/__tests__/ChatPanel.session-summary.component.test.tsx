import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { createSections, makeMessage } from './ChatPanel.test-utils'
import {
  advanceSessionResourceBackfill,
  chatPanelElement,
  listSessionResources,
  notifyResize,
  renderPanel,
  SESSION,
  setupChatPanelSessionSummaryHarness,
  toggleSessionSummaryPanel,
  useChatPanelSectionsMock,
} from './chat-panel-session-summary.test-harness'

describe('ChatPanel session summary and setup dock', () => {
  beforeEach(() => {
    setupChatPanelSessionSummaryHarness()
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
    expect(advanceSessionResourceBackfill).not.toHaveBeenCalled()
    expect(listSessionResources).not.toHaveBeenCalled()
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
    act(() => toggleSessionSummaryPanel('session-1'))
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

    expect(chatPanel).toHaveAttribute('data-session-summary-space', 'constrained')
    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
    act(() => toggleSessionSummaryPanel('session-1'))
    expect(screen.getByRole('complementary', { name: 'Session Summary' })).toBeInTheDocument()
  })

  it('auto-hides at a medium width where the panel would overlap centered chat content', () => {
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
    Object.defineProperty(chatPanel, 'clientWidth', { configurable: true, value: 1_200 })

    act(() => notifyResize())

    expect(chatPanel).toHaveAttribute('data-session-summary-space', 'constrained')
    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
    act(() => toggleSessionSummaryPanel('session-1'))
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

  it('orders gallery images by persisted transcript node identity', async () => {
    const resource = (
      id: string,
      title: string,
      nodeId: string,
      createdAt: number,
    ): SessionResource => ({
      id,
      sessionId: SessionId('session-1'),
      canonicalKey: `sha256:${id}`,
      kind: 'image',
      title,
      mimeType: 'image/png',
      locator: `session-resource://${id}`,
      managed: true,
      available: true,
      isSource: false,
      isOutput: true,
      occurrences: [
        {
          id: `occurrence-${id}`,
          nodeId,
          branchId: 'branch-1',
          actor: 'agent',
          activity: 'created',
          label: null,
          locator: `session-resource://${id}`,
          createdAt,
        },
      ],
      createdAt,
      updatedAt: createdAt,
    })
    listSessionResources.mockResolvedValue({
      resources: [
        resource('hidden-image', 'hidden.png', 'hidden-node', 1),
        resource('active-image', 'active.png', 'persisted-node', 2),
      ],
      backfillComplete: true,
    })
    useUIStore.getState().openResourceViewer('session-1', 'active-image')
    const message = makeMessage({
      id: 'runtime-message-id',
      role: 'assistant',
      metadata: { sessionNodeId: 'persisted-node' },
    })

    renderPanel({ messages: [message] }, { isFirstMessage: false, session: SESSION })

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: active.png' }),
    ).toBeInTheDocument()
    expect(await screen.findByLabelText('Image provenance')).toHaveTextContent('1 of 2')
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
    rerender(chatPanelElement())
    expect(screen.queryByRole('group', { name: 'Session setup' })).not.toBeInTheDocument()
  })
})
