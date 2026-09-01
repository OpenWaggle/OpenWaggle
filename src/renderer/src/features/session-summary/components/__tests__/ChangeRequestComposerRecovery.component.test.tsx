import { SessionId, WorkingPath } from '@shared/types/brand'
import type { VcsStatus } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { ChangeRequestComposer } from '../ChangeRequestComposer'

const runStackedGitAction = vi.hoisted(() => vi.fn())
const openExternal = vi.hoisted(() => vi.fn())
const recordSessionChangeRequest = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: { runStackedGitAction, openExternal, recordSessionChangeRequest },
}))

const SESSION: SessionDetail = {
  id: SessionId('session-1'),
  title: 'Explore image hub parity',
  projectPath: '/project',
  messages: [],
  createdAt: 1000,
  updatedAt: 1000,
}

const VCS_STATUS: VcsStatus = {
  isRepo: true,
  sourceControlProvider: { id: 'github', host: 'github.com' },
  hasPrimaryRemote: true,
  defaultRef: 'main',
  isDefaultRef: false,
  refName: 'codex/existing-branch',
  pushTargetRef: 'codex/existing-branch',
  pushTargetIsDefaultRef: false,
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: true,
  aheadCount: 1,
  behindCount: 0,
  aheadOfDefaultCount: 1,
  changeRequest: null,
}

function renderComposer() {
  const onClose = vi.fn()
  const onCompleted = vi.fn()
  renderWithQueryClient(
    <ChangeRequestComposer
      session={SESSION}
      workingPath={WorkingPath('/project')}
      gitStatus={null}
      vcsStatus={VCS_STATUS}
      onClose={onClose}
      onCompleted={onCompleted}
    />,
  )
  return { onClose, onCompleted }
}

describe('ChangeRequestComposer recovery', () => {
  beforeEach(() => {
    useUIStore.setState({ toastMessage: null, toastData: null })
    runStackedGitAction.mockReset().mockResolvedValue({
      ok: true,
      action: 'create_pr',
      branch: { status: 'unchanged', name: null },
      changeRequest: {
        title: SESSION.title,
        url: 'https://github.com/openwaggle/openwaggle/pull/1',
        baseRef: 'main',
        headRef: 'codex/existing-branch',
        state: 'open',
      },
      changeRequestOutput: {
        ok: false,
        retryPersisted: true,
        message: 'The change request was created, but Outputs could not be updated.',
      },
    })
    openExternal.mockReset().mockResolvedValue(undefined)
    recordSessionChangeRequest.mockReset().mockResolvedValue({})
  })

  it('clears a failed-attempt browser fallback when request fields change', async () => {
    runStackedGitAction.mockResolvedValue({
      ok: false,
      phase: 'pr',
      code: 'change-request-failed',
      message: 'GitHub CLI is unavailable.',
      fallbackUrl: 'https://github.com/openwaggle/openwaggle/compare/main...feature?expand=1',
    })
    renderComposer()

    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))
    const browserButton = await screen.findByRole('button', { name: 'Open PR in browser' })
    expect(browserButton).toBeEnabled()

    fireEvent.change(screen.getByDisplayValue(SESSION.title), { target: { value: 'New title' } })
    expect(browserButton).toBeDisabled()
  })

  it('retries session output recording without creating a duplicate request', async () => {
    const callbacks = renderComposer()

    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The change request was created, but Outputs could not be updated.',
    )
    expect(screen.queryByRole('button', { name: 'Create PR' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open PR in browser' })).toBeEnabled()
    expect(callbacks.onCompleted).toHaveBeenCalledOnce()
    expect(callbacks.onClose).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry adding PR to Outputs' })).toHaveFocus(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry adding PR to Outputs' }))

    await waitFor(() => expect(recordSessionChangeRequest).toHaveBeenCalledOnce())
    expect(runStackedGitAction).toHaveBeenCalledOnce()
    expect(callbacks.onCompleted).toHaveBeenCalledOnce()
    expect(callbacks.onClose).toHaveBeenCalledOnce()
  })

  it('does not offer an unauthorized retry or duplicate creation when retry persistence failed', async () => {
    runStackedGitAction.mockResolvedValue({
      ok: true,
      action: 'create_pr',
      branch: { status: 'unchanged', name: null },
      changeRequest: {
        title: SESSION.title,
        url: 'https://github.com/openwaggle/openwaggle/pull/1',
        baseRef: 'main',
        headRef: 'codex/existing-branch',
        state: 'open',
      },
      changeRequestOutput: {
        ok: false,
        retryPersisted: false,
        message:
          'The change request was created, but its Output and durable retry could not be recorded.',
      },
    })
    renderComposer()

    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'durable retry could not be recorded',
    )
    expect(screen.queryByRole('button', { name: 'Retry adding PR to Outputs' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create PR' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open PR in browser' })).toBeEnabled()
    expect(runStackedGitAction).toHaveBeenCalledOnce()
  })

  it('surfaces a failed commit Output projection after the pull request succeeds', async () => {
    runStackedGitAction.mockResolvedValue({
      ok: true,
      action: 'commit_push_pr',
      branch: { status: 'created', name: 'codex/existing-branch' },
      commit: { commitHash: 'abc123', summary: SESSION.title },
      commitOutput: {
        ok: false,
        retryPersisted: false,
        message: 'The commit succeeded, but its Output and durable retry could not be recorded.',
      },
      changeRequest: {
        title: SESSION.title,
        url: 'https://github.com/openwaggle/openwaggle/pull/1',
        baseRef: 'main',
        headRef: 'codex/existing-branch',
        state: 'open',
      },
      changeRequestOutput: { ok: true },
    })
    const callbacks = renderComposer()

    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))

    await waitFor(() => expect(callbacks.onClose).toHaveBeenCalledOnce())
    expect(useUIStore.getState().toastData).toEqual({
      message: 'The commit succeeded, but its Output and durable retry could not be recorded.',
      variant: 'error',
    })
    expect(openExternal).toHaveBeenCalledWith('https://github.com/openwaggle/openwaggle/pull/1')
  })

  it('reports both a later PR failure and the earlier commit Output failure', async () => {
    runStackedGitAction.mockResolvedValue({
      ok: false,
      phase: 'pr',
      code: 'change-request-failed',
      message: 'GitHub authentication is required.',
      commit: { commitHash: 'abc123', summary: SESSION.title },
      commitOutput: {
        ok: false,
        retryPersisted: true,
        message: 'The commit Output will be retried automatically.',
      },
    })
    renderComposer()

    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'GitHub authentication is required. The commit Output will be retried automatically.',
    )
  })

  it('keeps the create control focused and announces progress while creating', async () => {
    let resolveAction: ((value: unknown) => void) | undefined
    runStackedGitAction.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve
      }),
    )
    const callbacks = renderComposer()
    const createButton = screen.getByRole('button', { name: 'Create PR' })
    createButton.focus()

    fireEvent.click(createButton)

    expect(createButton).toHaveFocus()
    expect(createButton).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Creating PR…')
    const closeButton = screen.getByRole('button', { name: 'Close change request composer' })
    expect(closeButton).toBeDisabled()
    fireEvent.click(closeButton)
    expect(callbacks.onClose).not.toHaveBeenCalled()
    resolveAction?.({
      ok: true,
      action: 'create_pr',
      branch: { status: 'unchanged', name: null },
      changeRequest: null,
    })
    await waitFor(() => expect(runStackedGitAction).toHaveBeenCalledOnce())
  })

  it('announces output recording as a separate phase from remote creation', async () => {
    let resolveRecording: (() => void) | undefined
    recordSessionChangeRequest.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRecording = resolve
      }),
    )
    renderComposer()

    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))

    const retry = await screen.findByRole('button', { name: 'Retry adding PR to Outputs' })
    fireEvent.click(retry)

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Adding PR to Outputs…'),
    )
    expect(screen.getByRole('status')).not.toHaveTextContent('Creating PR…')
    resolveRecording?.()
    await waitFor(() => expect(openExternal).toHaveBeenCalledOnce())
  })
})
