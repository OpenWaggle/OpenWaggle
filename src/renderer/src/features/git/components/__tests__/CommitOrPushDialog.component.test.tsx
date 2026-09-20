import { WorkingPath } from '@shared/types/brand'
import type { GitRunStackedActionResult, GitStatusSummary, VcsStatus } from '@shared/types/git'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommitOrPushDialog } from '../CommitOrPushDialog'

const validateGitBranchName = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({ api: { validateGitBranchName } }))

const STATUS: GitStatusSummary = {
  branch: 'feature/current',
  additions: 9,
  deletions: 3,
  filesChanged: 2,
  changedFiles: [
    {
      path: 'staged.ts',
      status: 'modified',
      staged: true,
      unstaged: false,
      additions: 4,
      deletions: 1,
    },
    {
      path: 'unstaged.ts',
      status: 'modified',
      staged: false,
      unstaged: true,
      additions: 5,
      deletions: 2,
    },
  ],
  stagedChanges: { filesChanged: 1, additions: 4, deletions: 1 },
  unstagedChanges: { filesChanged: 1, additions: 5, deletions: 2 },
  clean: false,
  ahead: 1,
  behind: 0,
}

function vcs(overrides: Partial<VcsStatus> = {}) {
  return fromPartial<VcsStatus>({
    isRepo: true,
    sourceControlProvider: { id: 'github', host: 'github.com' },
    hasPrimaryRemote: true,
    defaultRef: 'main',
    isDefaultRef: false,
    refName: 'feature/current',
    pushTargetRef: 'feature/current',
    pushTargetIsDefaultRef: false,
    hasWorkingTreeChanges: true,
    workingTree: { files: [], insertions: 9, deletions: 3 },
    hasUpstream: true,
    aheadCount: 1,
    behindCount: 0,
    aheadOfDefaultCount: 1,
    changeRequest: null,
    ...overrides,
  })
}

function renderDialog(
  overrides: {
    readonly repository?: Partial<React.ComponentProps<typeof CommitOrPushDialog>['repository']>
    readonly operation?: Partial<React.ComponentProps<typeof CommitOrPushDialog>['operation']>
  } = {},
) {
  const onRun = vi.fn().mockResolvedValue({
    ok: true,
    action: 'commit',
    branch: { status: 'unchanged', name: null },
    commit: { commitHash: 'abc', summary: 'Ship it' },
    changeRequest: null,
  })
  const onClose = vi.fn()
  const onCancelRun = vi.fn().mockResolvedValue(true)
  const repository = {
    sessionTitle: 'Session summary parity',
    workingPath: WorkingPath('/project'),
    gitStatus: STATUS,
    vcsStatus: vcs(),
    remoteState: 'loaded' as const,
    branches: [],
    ...overrides.repository,
  }
  const operation = {
    running: false,
    progress: null,
    run: onRun,
    stop: onCancelRun,
    ...overrides.operation,
  }
  const view = render(
    <CommitOrPushDialog repository={repository} operation={operation} onClose={onClose} />,
  )
  return {
    onRun,
    onClose,
    onCancelRun,
    rerenderOperation: (
      next: Partial<React.ComponentProps<typeof CommitOrPushDialog>['operation']>,
    ) =>
      view.rerender(
        <CommitOrPushDialog
          repository={repository}
          operation={{ ...operation, ...next }}
          onClose={onClose}
        />,
      ),
  }
}

describe('CommitOrPushDialog', () => {
  beforeEach(() => {
    validateGitBranchName.mockReset().mockResolvedValue({ ok: true })
  })

  it('shows exact staged and unstaged stats and can commit only the index', async () => {
    const callbacks = renderDialog()
    expect(screen.getByText('1 staged file')).toBeInTheDocument()
    expect(screen.getByText('+4')).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()
    expect(screen.getByText('1 unstaged file')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'Ship it' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Include unstaged changes/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))

    await waitFor(() =>
      expect(callbacks.onRun).toHaveBeenCalledWith(
        'commit',
        expect.objectContaining({
          commitMessage: 'Ship it',
          includeUnstaged: false,
          paths: ['staged.ts'],
        }),
      ),
    )
  })

  it('validates an exact new branch and explains an ancestor ref collision', async () => {
    validateGitBranchName.mockResolvedValue({
      ok: false,
      code: 'branch-exists',
      message: 'Branch "feature/current/child" conflicts with existing ref "feature/current".',
    })
    renderDialog()
    fireEvent.change(screen.getByLabelText('Commit target'), { target: { value: 'new' } })
    fireEvent.change(screen.getByLabelText('New branch name'), {
      target: { value: 'feature/current/child' },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('conflicts with existing ref')
    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled()
  })

  it('uses modifier-enter for the enabled Commit & push action', async () => {
    const callbacks = renderDialog()
    const message = screen.getByLabelText('Commit message')
    fireEvent.change(message, { target: { value: 'Ship it' } })
    fireEvent.keyDown(message, { key: 'Enter', metaKey: true })

    await waitFor(() =>
      expect(callbacks.onRun).toHaveBeenCalledWith(
        'commit_push',
        expect.objectContaining({ commitMessage: 'Ship it' }),
      ),
    )
  })

  it('offers first push for a clean branch ahead of the default branch without an upstream', () => {
    renderDialog({
      repository: {
        gitStatus: { ...STATUS, clean: true, filesChanged: 0, changedFiles: [] },
        vcsStatus: vcs({
          hasWorkingTreeChanges: false,
          hasUpstream: false,
          aheadCount: 0,
          aheadOfDefaultCount: 2,
        }),
      },
    })
    expect(screen.getByRole('button', { name: 'Push' })).toBeEnabled()
  })

  it('recovers a detached HEAD through a new branch rooted at the current commit', async () => {
    const callbacks = renderDialog({
      repository: {
        gitStatus: { ...STATUS, branch: 'detached@abc123' },
        vcsStatus: vcs({ refName: null, pushTargetRef: null, hasUpstream: false }),
      },
    })

    expect(screen.getByLabelText('Commit target')).toHaveValue('new')
    expect(screen.getByText('New branch → detached HEAD')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'Ship it' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Commit' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))

    await waitFor(() =>
      expect(callbacks.onRun).toHaveBeenCalledWith(
        'commit',
        expect.objectContaining({
          createFeatureBranch: true,
          exactFeatureBranchName: true,
          baseRef: 'HEAD',
        }),
      ),
    )
  })

  it('roots a new branch at live HEAD even when named-branch status is stale', async () => {
    const callbacks = renderDialog()

    fireEvent.change(screen.getByLabelText('Commit target'), { target: { value: 'new' } })
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'Ship it' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Commit' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))

    await waitFor(() =>
      expect(callbacks.onRun).toHaveBeenCalledWith(
        'commit',
        expect.objectContaining({ createFeatureBranch: true, baseRef: 'HEAD' }),
      ),
    )
  })

  it('adopts a branch created before a partial failure so retry does not recreate it', async () => {
    const onRun = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        phase: 'push',
        code: 'push-failed',
        message: 'Push failed.',
        branch: { status: 'created', name: 'codex/session-summary-parity' },
      })
      .mockResolvedValueOnce({
        ok: true,
        action: 'commit_push',
        branch: { status: 'unchanged', name: null },
        commit: null,
        changeRequest: null,
      })
    renderDialog({ operation: { run: onRun } })

    fireEvent.change(screen.getByLabelText('Commit target'), { target: { value: 'new' } })
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'Ship it' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Commit & push' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Commit & push' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Push failed.')
    expect(screen.getByLabelText('Commit target')).toHaveValue('current')
    expect(screen.getByText('Current branch → codex/session-summary-parity')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Commit & push' }))
    await waitFor(() => expect(onRun).toHaveBeenCalledTimes(2))
    expect(onRun.mock.calls[1]).toEqual([
      'commit_push',
      expect.objectContaining({
        createFeatureBranch: false,
        featureBranchName: undefined,
      }),
    ])
  })

  it('shows phase progress and routes cancellation while an action is running', () => {
    const callbacks = renderDialog({
      operation: {
        running: true,
        progress: { phase: 'push', label: 'Pushing...', index: 1, total: 2 },
      },
    })
    expect(screen.getByRole('status')).toHaveTextContent('Pushing...')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Stopping takes effect after the current Git step finishes.',
    )
    const stop = screen.getByRole('button', { name: 'Stop after current step' })
    stop.focus()
    fireEvent.click(stop)
    expect(callbacks.onCancelRun).toHaveBeenCalledOnce()
    const requested = screen.getByRole('button', { name: 'Stop requested' })
    expect(requested).toBe(stop)
    expect(requested).toBeEnabled()
    expect(requested).toHaveAttribute('aria-disabled', 'true')
    expect(requested).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Stop requested. The current Git step will finish first.',
    )
  })

  it('keeps the initiating action focused and freezes fields while Git is running', () => {
    const callbacks = renderDialog({
      operation: {
        run: vi.fn(() => new Promise<GitRunStackedActionResult | undefined>(() => {})),
      },
    })
    const message = screen.getByLabelText('Commit message')
    fireEvent.change(message, { target: { value: 'Ship it' } })
    const action = screen.getByRole('button', { name: 'Commit & push' })
    const status = screen.getByRole('status')
    action.focus()

    fireEvent.click(action)
    callbacks.rerenderOperation({
      running: true,
      progress: { phase: 'push', label: 'Pushing...', index: 1, total: 2 },
    })

    expect(action).toHaveFocus()
    expect(action).toBeEnabled()
    expect(action).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent('Pushing...')
    expect(message).toHaveAttribute('readonly')
    expect(message).toHaveAttribute('aria-disabled', 'true')
    fireEvent.change(message, { target: { value: 'A stale edit' } })
    expect(message).toHaveValue('Ship it')
    const close = screen.getByRole('button', { name: 'Close commit or push' })
    expect(close).toBeEnabled()
    expect(close).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(close)
    expect(callbacks.onClose).not.toHaveBeenCalled()
  })
})
