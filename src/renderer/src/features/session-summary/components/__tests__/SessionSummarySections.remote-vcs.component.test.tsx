import { SessionId } from '@shared/types/brand'
import type { VcsStatus } from '@shared/types/git'
import type { SessionResource } from '@shared/types/session-resource'
import { fireEvent, render, screen } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { EnvironmentSummarySection, SessionChangeRequestsSection } from '../SessionSummarySections'

const GITHUB_STATUS = fromPartial<VcsStatus>({
  isRepo: true,
  sourceControlProvider: { id: 'github', host: 'github.com' },
  changeRequest: null,
})

function input(
  remoteVcsState: 'loading' | 'loaded' | 'error' | 'unavailable',
  onCreateChangeRequest = vi.fn(),
  onRefreshVcsStatus = vi.fn(),
  onViewChangeRequest = vi.fn(),
) {
  return {
    expanded: true,
    environmentMode: 'local' as const,
    workingPath: null,
    gitStatus: null,
    vcsStatus: GITHUB_STATUS,
    remoteVcsState,
    localVcsState: 'loaded' as const,
    branches: [],
    branchBusy: false,
    branchError: null,
    onExpandedChange: vi.fn(),
    onOpenDiff: vi.fn(),
    onCreateChangeRequest,
    onViewChangeRequest,
    onToggleTerminal: vi.fn(),
    onRefreshBranches: vi.fn(),
    onRefreshVcsStatus,
    onSelectBranch: vi.fn().mockResolvedValue(true),
    onCreateBranch: vi.fn().mockResolvedValue(true),
    quickAction: {
      kind: 'show_hint' as const,
      label: 'Commit or push',
      disabled: true,
      hint: 'Unavailable',
    },
    onQuickAction: vi.fn(),
  }
}

describe('Session Summary remote change-request state', () => {
  it('omits inert Git rows when the opened environment is not a repository', () => {
    render(
      <EnvironmentSummarySection
        input={{ ...input('unavailable'), vcsStatus: null, workingPath: '/tmp/project' }}
      />,
    )

    expect(screen.getByRole('button', { name: 'Environment: Local' })).toBeInTheDocument()
    expect(screen.queryByText('Changes')).toBeNull()
    expect(screen.queryByRole('button', { name: /Branch:/ })).toBeNull()
    expect(screen.queryByText('Commit or push')).toBeNull()
    expect(screen.queryByText(/PR status/)).toBeNull()
  })

  it('never offers creation before existing-request discovery settles', () => {
    const onCreate = vi.fn()
    const { rerender } = render(<EnvironmentSummarySection input={input('loading', onCreate)} />)

    const checking = screen.getByRole('button', { name: 'Checking PR status…' })
    expect(checking).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(checking)
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Create PR' })).toBeNull()

    rerender(<EnvironmentSummarySection input={input('loaded', onCreate)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))
    expect(onCreate).toHaveBeenCalledOnce()
  })

  it('disables request creation on a detached HEAD with a recovery reason', () => {
    const onCreate = vi.fn()
    render(
      <EnvironmentSummarySection
        input={{
          ...input('loaded', onCreate),
          vcsStatus: fromPartial<VcsStatus>({ ...GITHUB_STATUS, refName: null }),
        }}
      />,
    )

    const create = screen.getByRole('button', { name: 'Create PR' })
    expect(create).toHaveAttribute('aria-disabled', 'true')
    expect(create).toHaveAttribute(
      'title',
      'Create or check out a branch before creating a pull request.',
    )
    fireEvent.click(create)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('waits for detailed dirty-file status before opening the composer', () => {
    const onCreate = vi.fn()
    render(
      <EnvironmentSummarySection
        input={{
          ...input('loaded', onCreate),
          gitStatus: null,
          vcsStatus: fromPartial<VcsStatus>({
            ...GITHUB_STATUS,
            refName: 'main',
            defaultRef: 'main',
            isDefaultRef: true,
            hasWorkingTreeChanges: true,
          }),
        }}
      />,
    )

    const create = screen.getByRole('button', { name: 'Create PR' })
    expect(create).toHaveAttribute('aria-disabled', 'true')
    expect(create).toHaveAttribute(
      'title',
      'Waiting for local change details before creating a pull request.',
    )
    fireEvent.click(create)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('offers a status retry, not creation, after remote discovery fails', () => {
    const onRefresh = vi.fn()
    render(<EnvironmentSummarySection input={input('error', vi.fn(), onRefresh)} />)

    expect(screen.queryByRole('button', { name: 'Create PR' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry PR status' }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('keeps a retry action visible after local status recovery is exhausted', () => {
    const onQuickAction = vi.fn()
    render(
      <EnvironmentSummarySection
        input={{
          ...input('error'),
          gitStatus: null,
          vcsStatus: null,
          localVcsState: 'error',
          quickAction: {
            kind: 'refresh_status',
            label: 'Retry Git status',
            disabled: false,
          },
          onQuickAction,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry Git status' }))
    expect(onQuickAction).toHaveBeenCalledOnce()
  })

  it('opens an existing request in the Session-bound inspector', () => {
    const onView = vi.fn()
    render(
      <EnvironmentSummarySection
        input={{
          ...input('loaded', vi.fn(), vi.fn(), onView),
          vcsStatus: {
            ...GITHUB_STATUS,
            changeRequest: {
              title: 'Lifecycle',
              url: 'https://github.com/o/r/pull/7',
              baseRef: 'main',
              headRef: 'feature',
              state: 'open',
            },
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'View PR' }))
    expect(onView).toHaveBeenCalledWith('https://github.com/o/r/pull/7')
  })

  it('discovers only additional Session-owned requests without duplicating the current one', () => {
    const onOpen = vi.fn()
    const resource = (id: string, title: string, locator: string) =>
      fromPartial<SessionResource>({
        id,
        sessionId: SessionId('session-a'),
        kind: 'change-request',
        title,
        locator,
        isOutput: true,
      })
    render(
      <SessionChangeRequestsSection
        resources={[
          resource('current', 'Current', 'https://github.com/o/r/pull/7?diff=split'),
          resource('other', 'Another Session request', 'https://github.com/o/r/pull/8'),
          fromPartial<SessionResource>({
            id: 'foreign-kind',
            sessionId: SessionId('session-a'),
            kind: 'link',
            title: 'Not a request',
            locator: 'https://github.com/o/r/pull/9',
            isOutput: true,
          }),
        ]}
        currentUrl="https://github.com/o/r/pull/7"
        provider="github"
        expanded
        onExpandedChange={vi.fn()}
        onOpen={onOpen}
      />,
    )

    expect(screen.getByRole('button', { name: 'Other pull requests 1' })).toBeInTheDocument()
    expect(screen.queryByText('Current')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Another Session request' }))
    expect(onOpen).toHaveBeenCalledWith('https://github.com/o/r/pull/8')
  })
})
