import type { VcsStatus } from '@shared/types/git'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import {
  getChangeRequestOpenDestination,
  hubVcsStatus,
  invalidateVcsStatus,
  openExternal,
  refreshSourceControlStatus,
  renderHub,
  session,
  setupSessionSummaryHubHarness,
  useCombinedVcsStatus,
} from './session-summary-hub.test-harness'

const REQUEST_URL = 'https://github.com/o/r/pull/7'

function mockStatus(overrides: Partial<VcsStatus>) {
  const refresh = vi.fn(async () => undefined)
  useCombinedVcsStatus.mockReturnValue({
    local: null,
    localState: 'loaded',
    remote: null,
    remoteState: 'loaded',
    status: { ...hubVcsStatus(), ...overrides },
    refresh,
  })
  return refresh
}

function withExistingRequest() {
  return mockStatus({
    changeRequest: {
      title: 'Lifecycle',
      url: REQUEST_URL,
      baseRef: 'main',
      headRef: 'feature',
      state: 'open',
    },
  })
}

describe('Session Summary change request destination', () => {
  beforeEach(() => {
    setupSessionSummaryHubHarness()
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, browserLinkTarget: 'system' },
      isLoaded: true,
    })
  })

  it("asks the Host for the Session project's destination", async () => {
    withExistingRequest()
    renderHub()

    await waitFor(() => expect(getChangeRequestOpenDestination).toHaveBeenCalledWith('/project'))
  })

  it('does not ask while the Session Summary is hidden', () => {
    withExistingRequest()
    renderHub({ autoHidden: true })

    expect(getChangeRequestOpenDestination).not.toHaveBeenCalled()
  })

  it('waits for the destination before routing a click', async () => {
    let answer: (value: { destination: 'website'; source: 'user' }) => void = () => undefined
    getChangeRequestOpenDestination.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    withExistingRequest()
    const onOpenChangeRequest = vi.fn()
    renderHub({ onOpenChangeRequest })

    const view = await screen.findByRole('button', { name: 'View PR' })
    expect(view).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(view)
    expect(onOpenChangeRequest).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()

    await act(async () => answer({ destination: 'website', source: 'user' }))
    await waitFor(() => expect(view).not.toHaveAttribute('aria-disabled'))
  })

  it('opens the provider website when the Host cannot say where requests open', async () => {
    getChangeRequestOpenDestination.mockRejectedValue(new Error('Host too old'))
    withExistingRequest()
    const onOpenChangeRequest = vi.fn()
    renderHub({ onOpenChangeRequest })

    await screen.findByRole('button', { name: 'Open in OpenWaggle' })
    fireEvent.click(screen.getByRole('button', { name: 'View PR' }))

    await waitFor(() => expect(openExternal).toHaveBeenCalledWith(REQUEST_URL))
    expect(onOpenChangeRequest).not.toHaveBeenCalled()
  })

  it('opens the provider website from the row when the Host says so', async () => {
    getChangeRequestOpenDestination.mockResolvedValue({ destination: 'website', source: 'user' })
    withExistingRequest()
    const onOpenChangeRequest = vi.fn()
    renderHub({ onOpenChangeRequest })

    const inspector = await screen.findByRole('button', { name: 'Open in OpenWaggle' })
    const view = screen.getByRole('button', { name: 'View PR' })
    await waitFor(() => expect(view).not.toHaveAttribute('aria-disabled'))
    fireEvent.click(view)
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith(REQUEST_URL))
    expect(onOpenChangeRequest).not.toHaveBeenCalled()

    fireEvent.click(inspector)
    expect(onOpenChangeRequest).toHaveBeenCalledWith(REQUEST_URL)
  })

  it('offers the repository site and the sign-in command when the Session has no terminal', async () => {
    mockStatus({
      sourceControlRepositoryUrl: 'https://github.com/o/r',
      changeRequestAttention: {
        kind: 'not-signed-in',
        provider: 'github',
        host: 'github.com',
        cli: 'gh',
        environmentTokenIgnored: false,
        ignoredTokenVariables: [],
      },
    })
    renderHub({ activeSession: { ...session(), projectPath: null } })

    expect(
      await screen.findByText(
        'env -u GITHUB_TOKEN -u GH_TOKEN -u GITHUB_ENTERPRISE_TOKEN -u GH_ENTERPRISE_TOKEN gh auth login --hostname github.com',
      ),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open on GitHub' }))
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith('https://github.com/o/r'))
  })

  it('drops the Host status cache, then re-reads status everywhere, on window focus', async () => {
    mockStatus({
      changeRequestAttention: {
        kind: 'not-signed-in',
        provider: 'github',
        host: 'github.com',
        cli: 'gh',
        environmentTokenIgnored: false,
        ignoredTokenVariables: [],
      },
    })
    renderHub()
    await screen.findByRole('region', { name: 'Change request setup' })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    // Every surface showing this working tree's status re-reads, not just the Summary.
    await waitFor(() => expect(invalidateVcsStatus).toHaveBeenCalledWith('/project'))
    expect(refreshSourceControlStatus).toHaveBeenCalledWith('/project')
    const dropped = refreshSourceControlStatus.mock.invocationCallOrder[0] ?? Infinity
    const reread = invalidateVcsStatus.mock.invocationCallOrder.at(-1) ?? -Infinity
    expect(dropped).toBeLessThan(reread)
  })
})
