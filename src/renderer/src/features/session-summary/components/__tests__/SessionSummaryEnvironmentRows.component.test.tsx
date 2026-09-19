import type { GitBranchInfo } from '@shared/types/git'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import {
  SessionBranchRow,
  SessionEnvironmentActions,
  SessionEnvironmentRow,
} from '../SessionSummaryEnvironmentRows'

const openPath = vi.hoisted(() => vi.fn())
const writeText = vi.fn()

vi.mock('@/shared/lib/ipc', () => ({ api: { openPath } }))

function branch(name: string, overrides: Partial<GitBranchInfo> = {}): GitBranchInfo {
  return {
    name,
    localName: name,
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
    useUIStore.setState({ toastMessage: null, toastData: null })
    openPath.mockReset().mockResolvedValue(undefined)
    writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  it('explains the bound environment and opens the exact working folder', () => {
    const canonicalPath =
      '/Users/diego/.codex/worktrees/01a03a0c-20e2-77f3-b7c6-37dce925aead/OpenWaggle'
    render(
      <>
        <SessionEnvironmentRow environmentMode="worktree" workingPath={canonicalPath} />
        <SessionEnvironmentActions workingPath={canonicalPath} onToggleTerminal={vi.fn()} />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Environment: Worktree' }))

    expect(screen.getByText(/environment is fixed after the first message/i)).toBeInTheDocument()
    expect(screen.getByText('OpenWaggle')).toBeInTheDocument()
    expect(screen.queryByText(canonicalPath)).toBeNull()
    expect(document.body.textContent).not.toContain('.codex/worktrees')
    fireEvent.click(screen.getByRole('button', { name: 'Environment: Worktree' }))
    fireEvent.click(screen.getByRole('button', { name: 'Environment actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open working folder' }))
    expect(openPath).toHaveBeenCalledWith(canonicalPath)
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

  it('reports working-folder and clipboard failures', async () => {
    openPath.mockRejectedValueOnce(new Error('The working folder is unavailable.'))
    writeText.mockRejectedValueOnce(new Error('Clipboard access was denied.'))
    render(
      <>
        <SessionEnvironmentActions workingPath="/project" onToggleTerminal={vi.fn()} />
        <SessionBranchRow
          branch="main"
          branches={[branch('main')]}
          busy={false}
          error={null}
          onRefresh={vi.fn()}
          onSelect={vi.fn().mockResolvedValue(true)}
          onCreate={vi.fn().mockResolvedValue(true)}
        />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Environment actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open working folder' }))
    await waitFor(() =>
      expect(useUIStore.getState().toastData).toEqual({
        message: 'The working folder is unavailable.',
        variant: 'error',
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Branch: main' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy branch name' }))
    await waitFor(() =>
      expect(useUIStore.getState().toastData).toEqual({
        message: 'Clipboard access was denied.',
        variant: 'error',
      }),
    )
  })
})
