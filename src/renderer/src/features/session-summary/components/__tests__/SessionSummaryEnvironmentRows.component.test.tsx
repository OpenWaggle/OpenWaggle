import type { GitBranchInfo } from '@shared/types/git'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SessionBranchRow,
  SessionEnvironmentActions,
  SessionEnvironmentRow,
} from '../SessionSummaryEnvironmentRows'

const openPath = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({ api: { openPath } }))

function branch(name: string, overrides: Partial<GitBranchInfo> = {}): GitBranchInfo {
  return {
    name,
    fullName: `refs/heads/${name}`,
    isCurrent: name === 'main',
    isRemote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    ...overrides,
  }
}

describe('Session Summary environment rows', () => {
  beforeEach(() => {
    openPath.mockReset().mockResolvedValue(undefined)
  })

  it('explains the bound environment and opens the exact working folder', () => {
    render(
      <>
        <SessionEnvironmentRow environmentMode="worktree" workingPath="/repo/.worktrees/a" />
        <SessionEnvironmentActions workingPath="/repo/.worktrees/a" onToggleTerminal={vi.fn()} />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Environment: Worktree' }))

    expect(screen.getByText(/environment is fixed after the first message/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Environment: Worktree' }))
    fireEvent.click(screen.getByRole('button', { name: 'Environment actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open working folder' }))
    expect(openPath).toHaveBeenCalledWith('/repo/.worktrees/a')
  })

  it('refreshes, searches, and checks out a branch through the guarded callback', async () => {
    const onRefresh = vi.fn()
    const onSelect = vi.fn().mockResolvedValue(true)
    render(
      <SessionBranchRow
        branch="main"
        branches={[branch('main'), branch('feature/resources')]}
        busy={false}
        error={null}
        onRefresh={onRefresh}
        onSelect={onSelect}
        onCreate={vi.fn().mockResolvedValue(true)}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Branch: main' }))
    expect(onRefresh).toHaveBeenCalledOnce()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search branches' }), {
      target: { value: 'resources' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'feature/resources' }))

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('feature/resources'))
    expect(screen.queryByRole('dialog', { name: 'Choose a session branch' })).toBeNull()
  })

  it('offers an unmatched search as a new branch', async () => {
    const onCreate = vi.fn().mockResolvedValue(true)
    render(
      <SessionBranchRow
        branch="main"
        branches={[branch('main')]}
        busy={false}
        error={null}
        onRefresh={vi.fn()}
        onSelect={vi.fn().mockResolvedValue(true)}
        onCreate={onCreate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Branch: main' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search branches' }), {
      target: { value: 'feature/new-hub' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create feature/new-hub' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('feature/new-hub'))
  })
})
