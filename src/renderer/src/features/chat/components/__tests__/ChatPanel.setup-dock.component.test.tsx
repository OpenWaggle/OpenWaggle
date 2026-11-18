import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSections } from './ChatPanel.test-utils'
import {
  chatPanelElement,
  preloadSessionSummaryOverlay,
  renderPanel,
  setupChatPanelSessionSummaryHarness,
  useChatPanelSectionsMock,
} from './chat-panel-session-summary.test-harness'

describe('ChatPanel session setup dock', () => {
  preloadSessionSummaryOverlay()

  beforeEach(() => {
    setupChatPanelSessionSummaryHarness()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
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
