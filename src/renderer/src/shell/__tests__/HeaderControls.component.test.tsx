import type { GitStatusSummary } from '@shared/types/git'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  CommitButton,
  DiffToggleButton,
  HeaderLeft,
  SessionTreeButton,
  TerminalButton,
} from '../HeaderControls'

function gitStatus() {
  return {
    branch: 'main',
    additions: 12,
    deletions: 3,
    filesChanged: 2,
    changedFiles: [],
    clean: false,
    ahead: 0,
    behind: 0,
  } satisfies GitStatusSummary
}

describe('HeaderControls', () => {
  it('renders the collapsed-sidebar header affordance and project label', () => {
    const onToggleSidebar = vi.fn()

    render(
      <HeaderLeft
        activeBranchName="feature/test"
        projectPath="/Users/demo/OpenWaggle"
        sidebarOpen={false}
        title="Working session"
        onToggleSidebar={onToggleSidebar}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))

    expect(screen.getByText('Working session')).toBeInTheDocument()
    expect(screen.getByText('/ feature/test')).toBeInTheDocument()
    expect(screen.getByText('OpenWaggle')).toBeInTheDocument()
    expect(onToggleSidebar).toHaveBeenCalledOnce()
  })

  it('disables terminal and commit buttons without a project', () => {
    render(
      <>
        <TerminalButton open={false} projectPath={null} onToggle={vi.fn()} />
        <CommitButton isCommitting={false} projectPath={null} onOpen={vi.fn()} />
      </>,
    )

    expect(screen.getByRole('button', { name: 'Open terminal' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open commit dialog' })).toBeDisabled()
  })

  it('delegates enabled terminal, session-tree, and diff actions', () => {
    const onToggleTerminal = vi.fn()
    const onToggleTree = vi.fn()
    const onToggleDiff = vi.fn()

    render(
      <>
        <TerminalButton open projectPath="/repo" onToggle={onToggleTerminal} />
        <SessionTreeButton hasSessionTree isChatRoute open={false} onToggle={onToggleTree} />
        <DiffToggleButton
          error={null}
          isChatRoute
          isLoading={false}
          open={false}
          projectPath="/repo"
          status={gitStatus()}
          onToggle={onToggleDiff}
        />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Hide terminal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Session Tree' }))
    fireEvent.click(screen.getByRole('button', { name: 'Toggle diff panel' }))

    expect(screen.getByText('+12')).toBeInTheDocument()
    expect(screen.getByText('-3')).toBeInTheDocument()
    expect(onToggleTerminal).toHaveBeenCalledOnce()
    expect(onToggleTree).toHaveBeenCalledOnce()
    expect(onToggleDiff).toHaveBeenCalledOnce()
  })

  it('shows non-status diff text for loading and error states', () => {
    const { rerender } = render(
      <DiffToggleButton
        error={null}
        isChatRoute
        isLoading
        open={false}
        projectPath="/repo"
        status={null}
        onToggle={vi.fn()}
      />,
    )

    expect(screen.getByText('Loading diff…')).toBeInTheDocument()

    rerender(
      <DiffToggleButton
        error="not a git repo"
        isChatRoute
        isLoading={false}
        open={false}
        projectPath="/repo"
        status={null}
        onToggle={vi.fn()}
      />,
    )

    expect(screen.getByText('Git unavailable')).toBeInTheDocument()
  })
})
