import type { ChangeRequestPreflightResult } from '@shared/types/git'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  openExternal,
  preflightChangeRequest,
  renderComposer,
  runStackedGitAction,
  SESSION,
  setupChangeRequestComposerMocks,
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
    })
    renderComposer({ gitStatus: null, isDefaultRef: false })

    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub CLI (gh) is not installed.')
    expect(screen.getByRole('button', { name: 'Create draft PR' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create PR' })).toBeDisabled()
    const browserAction = screen.getByRole('button', { name: 'Open PR in browser' })
    expect(browserAction).toBeEnabled()
    fireEvent.click(browserAction)

    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/openwaggle/openwaggle/compare?expand=1',
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
    })
    renderComposer({ provider: 'gitlab', gitStatus: null, isDefaultRef: false })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'GitLab CLI is not authenticated for gitlab.example.com.',
    )
    expect(screen.getByRole('button', { name: 'Create MR' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open MR in browser' })).toBeEnabled()
  })

  it('ignores an older preflight response after the request payload changes', async () => {
    const oldRequest = Promise.withResolvers<ChangeRequestPreflightResult>()
    const currentRequest = Promise.withResolvers<ChangeRequestPreflightResult>()
    preflightChangeRequest
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(currentRequest.promise)
    renderComposer({ gitStatus: null, isDefaultRef: false })

    await waitFor(() => expect(preflightChangeRequest).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByDisplayValue(SESSION.title), {
      target: { value: 'Updated request title' },
    })
    expect(screen.getByRole('status')).toHaveTextContent('Checking GitHub CLI')
    await waitFor(() => expect(preflightChangeRequest).toHaveBeenCalledTimes(2))
    expect(preflightChangeRequest.mock.calls[1]?.[1]).toMatchObject({
      title: 'Updated request title',
    })

    currentRequest.resolve({
      provider: { id: 'github', host: 'github.com' },
      readiness: {
        ok: true,
        status: { authenticated: true, account: 'current-user', host: 'github.com' },
      },
      browserUrl: 'https://github.com/openwaggle/openwaggle/compare?title=Updated+request+title',
    })
    expect(await screen.findByText('GitHub CLI ready as current-user.')).toBeInTheDocument()

    oldRequest.resolve({
      provider: { id: 'github', host: 'github.com' },
      readiness: {
        ok: false,
        code: 'not-authenticated',
        message: 'Stale authentication failure.',
      },
      browserUrl: null,
    })
    await waitFor(() => {
      expect(screen.getByText('GitHub CLI ready as current-user.')).toBeInTheDocument()
      expect(screen.queryByText('Stale authentication failure.')).toBeNull()
    })
  })
})
