import { WorkingPath } from '@shared/types/brand'
import type { VcsChangeRequestDetails } from '@shared/types/git'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { ChangeRequestPanel } from '../ChangeRequestPanel'

const apiMocks = vi.hoisted(() => ({
  getPanel: vi.fn(),
  merge: vi.fn(),
  openExternal: vi.fn(),
  refreshSourceControlStatus: vi.fn(),
  runSessionTerminalCommand: vi.fn(),
  watchSessionTerminalCommand: vi.fn(),
  invalidateVcsStatus: vi.fn(),
  configureSourceControl: vi.fn(),
}))

vi.mock('@/features/git', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/git')>()),
  invalidateVcsStatus: apiMocks.invalidateVcsStatus,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getChangeRequestPanel: apiMocks.getPanel,
    mergeChangeRequest: apiMocks.merge,
    openExternal: apiMocks.openExternal,
    refreshSourceControlStatus: apiMocks.refreshSourceControlStatus,
    configureSourceControl: apiMocks.configureSourceControl,
  },
}))

vi.mock('@/features/terminal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/terminal')>()),
  runSessionTerminalCommand: apiMocks.runSessionTerminalCommand,
  watchSessionTerminalCommand: apiMocks.watchSessionTerminalCommand,
}))

function details(overrides: Partial<VcsChangeRequestDetails> = {}): VcsChangeRequestDetails {
  return {
    title: 'Ship lifecycle panel',
    url: 'https://github.com/o/r/pull/7',
    baseRef: 'main',
    headRef: 'feature/panel',
    state: 'open',
    reference: '7',
    headCommit: 'abcdef1234567890',
    author: 'octocat',
    changedFiles: 1,
    additions: 4,
    deletions: 1,
    files: [{ path: 'src/panel.tsx', additions: 4, deletions: 1 }],
    checks: [{ name: 'Unit', status: 'passed', url: null }],
    reviewDecision: 'approved',
    mergeability: 'mergeable',
    commentsCount: 2,
    reviewsCount: 1,
    reviewThreadsCount: null,
    unresolvedReviewThreadsCount: null,
    merge: { allowed: true, reason: null, methods: ['merge', 'squash'] },
    ...overrides,
  }
}

describe('ChangeRequestPanel source-control attention', () => {
  beforeEach(() => {
    useUIStore.setState({ toastMessage: null, toastData: null })
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, browserLinkTarget: 'system' },
      isLoaded: true,
    })
    apiMocks.getPanel.mockReset().mockResolvedValue({
      ok: true,
      snapshot: {
        provider: { id: 'github', host: 'github.com' },
        currentRef: 'feature/panel',
        account: null,
        selected: details(),
        changeRequests: [
          details(),
          details({ title: 'Second request', url: 'https://github.com/o/r/pull/8' }),
        ],
      },
    })
    apiMocks.merge.mockReset().mockResolvedValue({
      ok: true,
      changeRequest: details({ state: 'merged' }),
    })
    apiMocks.openExternal.mockReset().mockResolvedValue(undefined)
    apiMocks.refreshSourceControlStatus.mockReset().mockResolvedValue(undefined)
    apiMocks.runSessionTerminalCommand.mockReset().mockReturnValue('terminal-1')
    apiMocks.watchSessionTerminalCommand.mockReset().mockReturnValue(() => undefined)
    apiMocks.invalidateVcsStatus.mockReset().mockResolvedValue(undefined)
    apiMocks.configureSourceControl.mockReset().mockResolvedValue({ ok: true })
  })

  it('names the Provider account that read the request', async () => {
    apiMocks.getPanel.mockResolvedValueOnce({
      ok: true,
      snapshot: {
        provider: { id: 'github', host: 'github.com' },
        currentRef: 'feature/panel',
        account: 'octo-enterprise',
        selected: details(),
        changeRequests: [],
      },
    })
    renderPanel()

    expect(await screen.findByText('via @octo-enterprise')).toBeInTheDocument()
  })

  it('explains a known failure with one fix and the provider website', async () => {
    apiMocks.getPanel.mockResolvedValueOnce({
      ok: false,
      code: 'cli-missing',
      message: 'gh is not authenticated.',
      attention: {
        kind: 'cli-missing',
        provider: 'github',
        host: 'github.com',
        cli: 'gh',
      },
    })
    renderPanel()

    expect(await screen.findByText('Install gh to see pull requests')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open on GitHub' }))
    await waitFor(() =>
      expect(apiMocks.openExternal).toHaveBeenCalledWith('https://github.com/o/r/pull/7'),
    )
  })

  it('keeps the provider website available after an unexplained failure', async () => {
    apiMocks.getPanel.mockResolvedValueOnce({
      ok: false,
      code: 'unknown',
      message: 'The provider timed out.',
    })
    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent('The provider timed out.')
    fireEvent.click(screen.getByRole('button', { name: 'Open on GitHub' }))
    await waitFor(() =>
      expect(apiMocks.openExternal).toHaveBeenCalledWith('https://github.com/o/r/pull/7'),
    )
  })

  it('signs in from the inspector and reloads with fresh Host status', async () => {
    apiMocks.getPanel.mockResolvedValueOnce({
      ok: false,
      code: 'not-authenticated',
      message: 'gh is not signed in.',
      attention: {
        kind: 'not-signed-in',
        provider: 'github',
        host: 'github.com',
        cli: 'gh',
        environmentTokenIgnored: false,
        ignoredTokenVariables: [],
      },
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to github.com' }))
    expect(apiMocks.runSessionTerminalCommand).toHaveBeenCalledWith(
      expect.objectContaining({ ownerKey: 'session-a', cwd: '/repo/session-a' }),
    )
    const finished = apiMocks.watchSessionTerminalCommand.mock.calls[0]?.[2]
    act(() => finished?.())

    await waitFor(() => expect(apiMocks.getPanel).toHaveBeenCalledTimes(2))
    expect(apiMocks.refreshSourceControlStatus).toHaveBeenCalledWith('/repo/session-a')
    expect(apiMocks.refreshSourceControlStatus.mock.invocationCallOrder[0]).toBeLessThan(
      apiMocks.getPanel.mock.invocationCallOrder[1] ?? 0,
    )
    // The Session Summary and Diff panel showing this tree re-read their status too.
    expect(apiMocks.invalidateVcsStatus).toHaveBeenCalledWith('/repo/session-a')
    expect(apiMocks.refreshSourceControlStatus.mock.invocationCallOrder[0]).toBeLessThan(
      apiMocks.invalidateVcsStatus.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('re-checks a missing CLI when the window regains focus', async () => {
    apiMocks.getPanel.mockResolvedValueOnce({
      ok: false,
      code: 'cli-missing',
      message: 'gh is not installed.',
      attention: { kind: 'cli-missing', provider: 'github', host: 'github.com', cli: 'gh' },
    })
    renderPanel()
    await screen.findByRole('region', { name: 'Change request inspector setup' })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(apiMocks.getPanel).toHaveBeenCalledTimes(2))
    expect(apiMocks.refreshSourceControlStatus).toHaveBeenCalledWith('/repo/session-a')
    expect(await screen.findByRole('heading', { name: 'Ship lifecycle panel' })).toBeInTheDocument()
  })

  it('moves focus to the request title once a provider choice loads it', async () => {
    apiMocks.getPanel.mockResolvedValueOnce({
      ok: false,
      code: 'invalid-target',
      message: 'Unknown provider.',
      attention: { kind: 'choose-provider', host: 'git.corp.example' },
    })
    renderPanel()
    const github = await screen.findByRole('button', { name: 'GitHub' })
    github.focus()

    fireEvent.click(github)

    const title = await screen.findByRole('heading', { name: 'Ship lifecycle panel' })
    await waitFor(() => expect(title).toHaveFocus())
  })
})

function renderPanel() {
  return renderWithQueryClient(
    <ChangeRequestPanel
      sessionId="session-a"
      workingPath={WorkingPath('/repo/session-a')}
      requestUrl="https://github.com/o/r/pull/7"
      open
      onClose={vi.fn()}
      onSelectRequest={vi.fn()}
      onOpenDiff={vi.fn()}
    />,
  )
}
