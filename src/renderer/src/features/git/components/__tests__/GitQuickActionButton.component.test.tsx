import type { VcsStatus } from '@shared/types/git'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GitQuickActionButton } from '../GitQuickActionButton'

function status(overrides: Partial<VcsStatus> = {}): VcsStatus {
  return {
    isRepo: true,
    sourceControlProvider: { id: 'github', host: 'github.com' },
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: 'feature/x',
    hasWorkingTreeChanges: true,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    aheadOfDefaultCount: 0,
    pr: null,
    ...overrides,
  }
}

function callbacks() {
  return {
    onRunAction: vi.fn(),
    onPull: vi.fn(),
    onOpenChangeRequest: vi.fn(),
    onPublish: vi.fn(),
  }
}

describe('GitQuickActionButton', () => {
  it('renders the resolved label and dispatches the stacked action', () => {
    const cb = callbacks()
    render(<GitQuickActionButton status={status()} isBusy={false} {...cb} />)
    const button = screen.getByRole('button', { name: /Commit, push & PR/ })
    fireEvent.click(button)
    expect(cb.onRunAction).toHaveBeenCalledWith('commit_push_pr')
  })

  it('dispatches pull when behind upstream', () => {
    const cb = callbacks()
    render(
      <GitQuickActionButton
        status={status({ hasWorkingTreeChanges: false, behindCount: 2 })}
        isBusy={false}
        {...cb}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }))
    expect(cb.onPull).toHaveBeenCalled()
  })

  it('opens the change request when a PR is open and the ref is clean', () => {
    const cb = callbacks()
    render(
      <GitQuickActionButton
        status={status({
          hasWorkingTreeChanges: false,
          pr: {
            title: 'T',
            url: 'https://x/1',
            baseRef: 'main',
            headRef: 'feature/x',
            state: 'open',
          },
        })}
        isBusy={false}
        {...cb}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /View PR/ }))
    expect(cb.onOpenChangeRequest).toHaveBeenCalled()
  })

  it('is disabled while busy', () => {
    const cb = callbacks()
    render(<GitQuickActionButton status={status()} isBusy={true} {...cb} />)
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(cb.onRunAction).not.toHaveBeenCalled()
  })
})
