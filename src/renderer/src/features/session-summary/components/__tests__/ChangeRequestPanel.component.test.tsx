import { WorkingPath } from '@shared/types/brand'
import type { VcsChangeRequestDetails } from '@shared/types/git'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { ChangeRequestPanel } from '../ChangeRequestPanel'

const apiMocks = vi.hoisted(() => ({
  getPanel: vi.fn(),
  merge: vi.fn(),
  openExternal: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getChangeRequestPanel: apiMocks.getPanel,
    mergeChangeRequest: apiMocks.merge,
    openExternal: apiMocks.openExternal,
  },
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

describe('ChangeRequestPanel', () => {
  beforeEach(() => {
    useUIStore.setState({ toastMessage: null, toastData: null })
    apiMocks.getPanel.mockReset().mockResolvedValue({
      ok: true,
      snapshot: {
        provider: { id: 'github', host: 'github.com' },
        currentRef: 'feature/panel',
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
  })

  it('does not query while the retained sidebar is closed', () => {
    renderWithQueryClient(
      <ChangeRequestPanel
        sessionId="session-a"
        workingPath={WorkingPath('/repo/session-a')}
        requestUrl="https://github.com/o/r/pull/7"
        open={false}
        onClose={vi.fn()}
        onSelectRequest={vi.fn()}
        onOpenDiff={vi.fn()}
      />,
    )
    expect(apiMocks.getPanel).not.toHaveBeenCalled()
  })

  it('shows lifecycle detail, switches requests, opens diff/browser, and merges by exact head', async () => {
    const onSelectRequest = vi.fn()
    const onOpenDiff = vi.fn()
    renderWithQueryClient(
      <ChangeRequestPanel
        sessionId="session-a"
        workingPath={WorkingPath('/repo/session-a')}
        requestUrl="https://github.com/o/r/pull/7"
        open
        onClose={vi.fn()}
        onSelectRequest={onSelectRequest}
        onOpenDiff={onOpenDiff}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Ship lifecycle panel' })).toBeInTheDocument()
    expect(screen.getByText('src/panel.tsx')).toBeInTheDocument()
    expect(screen.getByText('Unit')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh change request' }))
    await waitFor(() => expect(apiMocks.getPanel).toHaveBeenCalledTimes(2))
    fireEvent.change(screen.getByLabelText('Open requests'), {
      target: { value: 'https://github.com/o/r/pull/8' },
    })
    expect(onSelectRequest).toHaveBeenCalledWith('https://github.com/o/r/pull/8')

    fireEvent.click(screen.getByRole('button', { name: 'View branch diff' }))
    expect(onOpenDiff).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }))
    expect(apiMocks.openExternal).toHaveBeenCalledWith('https://github.com/o/r/pull/7')

    fireEvent.change(screen.getByLabelText('Merge method'), { target: { value: 'squash' } })
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => {
      expect(apiMocks.merge).toHaveBeenCalledWith('session-a', '/repo/session-a', {
        url: 'https://github.com/o/r/pull/7',
        expectedHeadCommit: 'abcdef1234567890',
        method: 'squash',
      })
    })
  })

  it('explains why merge is disabled', async () => {
    apiMocks.getPanel.mockResolvedValue({
      ok: true,
      snapshot: {
        provider: { id: 'github', host: 'github.com' },
        currentRef: 'feature/panel',
        selected: details({
          checks: [{ name: 'Unit', status: 'failed', url: null }],
          merge: {
            allowed: false,
            reason: 'Fix failing checks before merging.',
            methods: ['merge'],
          },
        }),
        changeRequests: [],
      },
    })
    renderWithQueryClient(
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
    expect(await screen.findByText('Fix failing checks before merging.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled()
  })

  it('reports a queued provider merge without claiming the request was merged', async () => {
    apiMocks.merge.mockResolvedValue({ ok: true, changeRequest: details({ state: 'open' }) })
    renderWithQueryClient(
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

    await screen.findByRole('heading', { name: 'Ship lifecycle panel' })
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    expect(
      await screen.findByText(
        'Merge submitted. The request remains open while the provider processes it.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Merge completed.')).toBeNull()
  })

  it('keeps merge focus and a stable live region while the provider request is pending', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof apiMocks.merge>>>()
    apiMocks.merge.mockReturnValue(pending.promise)
    renderWithQueryClient(
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

    await screen.findByRole('heading', { name: 'Ship lifecycle panel' })
    const status = screen.getByRole('status')
    const merge = screen.getByRole('button', { name: 'Merge' })
    merge.focus()
    fireEvent.click(merge)

    const merging = screen.getByRole('button', { name: 'Merging…' })
    expect(merging).toBe(merge)
    expect(merging).toHaveFocus()
    expect(merging).toBeEnabled()
    expect(merging).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent('Merging…')
    fireEvent.click(merging)
    expect(apiMocks.merge).toHaveBeenCalledOnce()

    pending.resolve({ ok: true, changeRequest: details({ state: 'merged' }) })
    expect(await screen.findByText('Merge completed.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBe(status)
  })

  it('reports a browser-launch failure', async () => {
    apiMocks.openExternal.mockRejectedValueOnce(new Error('No browser is available.'))
    renderWithQueryClient(
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

    fireEvent.click(await screen.findByRole('button', { name: 'Open in browser' }))

    await waitFor(() =>
      expect(useUIStore.getState().toastData).toEqual({
        message: 'No browser is available.',
        variant: 'error',
      }),
    )
  })
})
