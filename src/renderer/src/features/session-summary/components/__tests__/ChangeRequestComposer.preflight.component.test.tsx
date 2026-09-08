import type { VcsStatus } from '@shared/types/git'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  openExternal,
  preflightChangeRequest,
  renderComposer,
  runStackedGitAction,
  SESSION,
  setupChangeRequestComposerMocks,
  vcsStatus,
} from './change-request-composer.test-harness'

describe('ChangeRequestComposer preflight', () => {
  beforeEach(() => {
    setupChangeRequestComposerMocks()
  })

  it('blocks native creation when the provider CLI is missing and keeps browser creation available', async () => {
    preflightChangeRequest.mockResolvedValue({
      provider: { id: 'github', host: 'github.com' },
      readiness: {
        ok: false,
        code: 'cli-missing',
        message: 'GitHub CLI (gh) is not installed.',
      },
      browserUrl: 'https://github.com/openwaggle/openwaggle/compare?expand=1',
      plannedHeadRef: 'codex/explore-image-hub-parity',
    })
    renderComposer({ gitStatus: null, isDefaultRef: false })

    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub CLI (gh) is not installed.')
    expect(screen.getByRole('button', { name: 'Create draft PR' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create PR' })).toBeDisabled()
    const browserAction = screen.getByRole('button', { name: 'Open PR in browser' })
    expect(browserAction).toBeEnabled()
    fireEvent.click(browserAction)

    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/openwaggle/openwaggle/compare?expand=1&title=Explore+image+hub+parity&body=%23%23+Summary%0A%0A-+Explore+image+hub+parity',
    )
    expect(runStackedGitAction).not.toHaveBeenCalled()
  })

  it('names the exact unauthenticated provider host', async () => {
    preflightChangeRequest.mockResolvedValue({
      provider: { id: 'gitlab', host: 'gitlab.example.com' },
      readiness: {
        ok: true,
        status: { authenticated: false, account: null, host: null },
      },
      browserUrl: 'https://gitlab.example.com/openwaggle/openwaggle/-/merge_requests/new',
      plannedHeadRef: 'codex/explore-image-hub-parity',
    })
    renderComposer({ provider: 'gitlab', gitStatus: null, isDefaultRef: false })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'GitLab CLI is not authenticated for gitlab.example.com.',
    )
    expect(screen.getByRole('button', { name: 'Create MR' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open MR in browser' })).toBeEnabled()
  })

  it('shows and submits the exact collision-free branch planned by main', async () => {
    preflightChangeRequest.mockResolvedValue({
      provider: { id: 'github', host: 'github.com' },
      readiness: {
        ok: true,
        status: { authenticated: true, account: 'octocat', host: 'github.com' },
      },
      browserUrl: 'https://github.com/openwaggle/openwaggle/compare/main...planned',
      plannedHeadRef: 'codex/explore-image-hub-parity-2',
    })
    renderComposer()

    expect(await screen.findByDisplayValue('codex/explore-image-hub-parity-2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))
    await waitFor(() =>
      expect(runStackedGitAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          createFeatureBranch: true,
          featureBranchName: 'codex/explore-image-hub-parity-2',
          exactFeatureBranchName: true,
        }),
      ),
    )
  })

  it('recomposes browser fields locally without rerunning provider readiness', async () => {
    renderComposer({ gitStatus: null, isDefaultRef: false })

    await waitFor(() => expect(preflightChangeRequest).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByDisplayValue(SESSION.title), {
      target: { value: 'Updated request title' },
    })
    fireEvent.change(screen.getByLabelText('Description (leave empty to generate)'), {
      target: { value: 'Fresh description' },
    })
    await new Promise((resolve) => window.setTimeout(resolve, 350))

    expect(preflightChangeRequest).toHaveBeenCalledTimes(1)
    expect(preflightChangeRequest.mock.calls[0]?.[1]).toMatchObject({ title: '', body: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Open PR in browser' }))
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/openwaggle/openwaggle/compare?expand=1&title=Updated+request+title&body=Fresh+description',
    )
  })

  it('blocks a detached HEAD before provider preflight', async () => {
    const detached = fromPartial<VcsStatus>({ ...vcsStatus('github', false), refName: null })
    renderComposer({ vcs: detached, gitStatus: null })

    expect(
      await screen.findAllByText('Create or check out a branch before creating a pull request.'),
    ).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Create PR' })).toBeDisabled()
    expect(preflightChangeRequest).not.toHaveBeenCalled()
  })

  it('blocks dirty default-branch creation until detailed file status loads', async () => {
    renderComposer({ vcs: vcsStatus('github', true), gitStatus: null })

    expect(
      await screen.findAllByText(
        'Waiting for local change details before creating a pull request.',
      ),
    ).not.toHaveLength(0)
    expect(screen.queryByRole('checkbox', { name: /Commit and push local changes/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Create PR' })).toBeDisabled()
    expect(preflightChangeRequest).not.toHaveBeenCalled()
  })
})
