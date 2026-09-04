import { SessionId, WorkingPath } from '@shared/types/brand'
import type { GitRunStackedActionResult } from '@shared/types/git'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GIT_STATUS,
  openExternal,
  preflightChangeRequest,
  recordSessionChangeRequest,
  recordSessionCommit,
  renderComposer,
  runStackedGitAction,
  SESSION,
  setupChangeRequestComposerMocks,
  vcsStatus,
  waitForNativeCreationReady,
} from './change-request-composer.test-harness'

describe('ChangeRequestComposer', () => {
  beforeEach(() => {
    setupChangeRequestComposerMocks()
  })

  it('creates a GitHub PR from a new Codex branch and can commit local changes', async () => {
    const callbacks = renderComposer()
    const invalidateQueries = vi.spyOn(callbacks.queryClient, 'invalidateQueries')

    expect(screen.getByText('New branch → main')).toBeInTheDocument()
    expect(screen.getByLabelText('New branch name')).toHaveValue('codex/explore-image-hub-parity')
    expect(screen.getByRole('button', { name: 'Create draft PR' })).toBeInTheDocument()
    await waitForNativeCreationReady()
    expect(preflightChangeRequest).toHaveBeenCalledWith(WorkingPath('/project'), {
      headRef: 'codex/explore-image-hub-parity',
      baseRef: 'main',
      title: SESSION.title,
      body: '## Summary\n\n- Explore image hub parity\n\n## Changes\n\n- 1 changed files\n- +30 / -0',
      draft: false,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))

    await waitFor(() =>
      expect(runStackedGitAction).toHaveBeenCalledWith(
        WorkingPath('/project'),
        expect.objectContaining({
          action: 'commit_push_pr',
          paths: ['src/hub.tsx'],
          createFeatureBranch: true,
          featureBranchName: 'codex/explore-image-hub-parity',
          baseRef: 'main',
          draft: false,
        }),
      ),
    )
    expect(callbacks.onCompleted).toHaveBeenCalledOnce()
    expect(callbacks.onClose).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledWith('https://github.com/openwaggle/openwaggle/pull/1')
    expect(recordSessionChangeRequest).toHaveBeenCalledWith(SessionId('session-1'), {
      title: SESSION.title,
      url: 'https://github.com/openwaggle/openwaggle/pull/1',
    })
    expect(recordSessionCommit).toHaveBeenCalledWith(SessionId('session-1'), {
      commitHash: '0123456789abcdef0123456789abcdef01234567',
      title: SESSION.title,
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['session-resources', 'session-1'],
      exact: true,
    })
  })

  it('creates the normal request with the Codex modifier-enter shortcut', async () => {
    renderComposer({ gitStatus: null, isDefaultRef: false })

    await waitForNativeCreationReady()
    fireEvent.keyDown(screen.getByDisplayValue(SESSION.title), {
      key: 'Enter',
      ctrlKey: true,
    })

    await waitFor(() =>
      expect(runStackedGitAction).toHaveBeenCalledWith(
        WorkingPath('/project'),
        expect.objectContaining({ action: 'create_pr', draft: false }),
      ),
    )
  })

  it('announces the guarded workflow and prevents dismissal while git may be changing', async () => {
    const action = Promise.withResolvers<GitRunStackedActionResult>()
    runStackedGitAction.mockReturnValue(action.promise)
    const callbacks = renderComposer()

    await waitForNativeCreationReady()
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))

    expect(screen.getByRole('status')).toHaveTextContent('Checking prerequisites and creating PR')
    expect(screen.getByRole('button', { name: 'Close change request composer' })).toBeDisabled()
    expect(screen.getByDisplayValue(SESSION.title)).toBeDisabled()
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(callbacks.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close change request composer' }))
    expect(callbacks.onClose).not.toHaveBeenCalled()

    action.resolve({
      ok: false,
      phase: 'pr',
      code: 'change-request-failed',
      message: 'GitHub authentication is required.',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub authentication is required.')
    expect(screen.getByRole('button', { name: 'Close change request composer' })).toBeEnabled()
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(callbacks.onClose).toHaveBeenCalledOnce()
  })

  it('uses GitLab MR terminology and creates a draft without a new branch off default', async () => {
    runStackedGitAction.mockResolvedValue({
      ok: true,
      action: 'create_pr',
      branch: { status: 'unchanged', name: null },
      changeRequest: null,
    })
    preflightChangeRequest.mockResolvedValue({
      provider: { id: 'gitlab', host: 'gitlab.com' },
      readiness: {
        ok: true,
        status: { authenticated: true, account: 'octocat', host: 'gitlab.com' },
      },
      browserUrl: 'https://gitlab.com/openwaggle/openwaggle/-/merge_requests/new',
    })
    renderComposer({ provider: 'gitlab', isDefaultRef: false, gitStatus: null })

    expect(screen.getByText('Create merge request')).toBeInTheDocument()
    expect(screen.queryByLabelText('New branch name')).toBeNull()
    await waitForNativeCreationReady('GitLab')
    fireEvent.click(screen.getByRole('button', { name: 'Create draft MR' }))

    await waitFor(() =>
      expect(runStackedGitAction).toHaveBeenCalledWith(
        WorkingPath('/project'),
        expect.objectContaining({
          action: 'create_pr',
          createFeatureBranch: false,
          draft: true,
        }),
      ),
    )
  })

  it('uses the push-and-create workflow for a clean branch without an upstream', async () => {
    renderComposer({
      gitStatus: { ...GIT_STATUS, filesChanged: 0, changedFiles: [], clean: true, ahead: 2 },
      vcs: {
        ...vcsStatus('github', false),
        hasWorkingTreeChanges: false,
        hasUpstream: false,
        aheadCount: 2,
      },
    })

    expect(screen.queryByText('Commit and push local changes')).toBeNull()
    await waitForNativeCreationReady()
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))

    await waitFor(() =>
      expect(runStackedGitAction).toHaveBeenCalledWith(
        WorkingPath('/project'),
        expect.objectContaining({ action: 'create_pr', createFeatureBranch: false }),
      ),
    )
  })

  it('does not create an empty feature branch when local changes are excluded', () => {
    renderComposer({
      vcs: { ...vcsStatus('github', true), aheadCount: 0 },
    })

    fireEvent.click(screen.getByRole('checkbox', { name: /Commit and push local changes/ }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Commit the local changes before creating a pull request from a new branch.',
    )
    expect(screen.getByRole('button', { name: 'Create draft PR' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create PR' })).toBeDisabled()
    expect(runStackedGitAction).not.toHaveBeenCalled()
  })

  it('does not create a second branch when the default ref is unknown', async () => {
    renderComposer({
      gitStatus: null,
      vcs: {
        ...vcsStatus('github', false),
        defaultRef: null,
        isDefaultRef: true,
        refName: 'feature/local-only',
      },
    })

    expect(screen.queryByLabelText('New branch name')).toBeNull()
    await waitForNativeCreationReady()
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))

    await waitFor(() =>
      expect(runStackedGitAction).toHaveBeenCalledWith(
        WorkingPath('/project'),
        expect.objectContaining({ action: 'create_pr', createFeatureBranch: false }),
      ),
    )
  })

  it('keeps provider failures in the composer for correction', async () => {
    runStackedGitAction.mockResolvedValue({
      ok: false,
      phase: 'pr',
      code: 'change-request-failed',
      message: 'GitHub authentication is required.',
    })
    renderComposer({ gitStatus: null, isDefaultRef: false })

    await waitForNativeCreationReady()
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub authentication is required.')
  })

  it('reuses a prepared branch after partial failure and exposes the browser fallback', async () => {
    runStackedGitAction
      .mockResolvedValueOnce({
        ok: false,
        phase: 'pr',
        code: 'change-request-failed',
        message: 'GitHub CLI is unavailable.',
        commitHash: 'fedcba9876543210fedcba9876543210fedcba98',
        branch: { status: 'created', name: 'codex/explore-image-hub-parity-2' },
        fallbackUrl:
          'https://github.com/openwaggle/openwaggle/compare/main...codex%2Fexplore-image-hub-parity-2?expand=1',
      })
      .mockResolvedValueOnce({
        ok: true,
        action: 'create_pr',
        branch: { status: 'unchanged', name: 'codex/explore-image-hub-parity-2' },
        changeRequest: null,
      })
    renderComposer({ gitStatus: null })

    await waitForNativeCreationReady()
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub CLI is unavailable.')
    expect(recordSessionCommit).toHaveBeenCalledWith(SessionId('session-1'), {
      commitHash: 'fedcba9876543210fedcba9876543210fedcba98',
      title: SESSION.title,
    })
    expect(screen.getByLabelText('New branch name')).toHaveValue('codex/explore-image-hub-parity-2')
    fireEvent.click(screen.getByRole('button', { name: 'Open PR in browser' }))
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/openwaggle/openwaggle/compare/main...codex%2Fexplore-image-hub-parity-2?expand=1',
    )

    await waitForNativeCreationReady()
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))
    await waitFor(() => expect(runStackedGitAction).toHaveBeenCalledTimes(2))
    expect(runStackedGitAction.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        createFeatureBranch: true,
        featureBranchName: 'codex/explore-image-hub-parity-2',
      }),
    )
  })
})
