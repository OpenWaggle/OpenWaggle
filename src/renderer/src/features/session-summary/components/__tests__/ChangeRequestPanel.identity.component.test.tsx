import { WorkingPath } from '@shared/types/brand'
import type { MergeChangeRequestResult, VcsChangeRequestDetails } from '@shared/types/git'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { ChangeRequestPanel } from '../ChangeRequestPanel'

const apiMocks = vi.hoisted(() => ({
  getPanel: vi.fn(),
  merge: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getChangeRequestPanel: apiMocks.getPanel,
    mergeChangeRequest: apiMocks.merge,
  },
}))

function details(url: string): VcsChangeRequestDetails {
  const reference = url.endsWith('/8') ? '8' : '7'
  return {
    title: `Request ${reference}`,
    url,
    baseRef: 'main',
    headRef: `feature/${reference}`,
    state: 'open',
    reference,
    headCommit: `head-${reference}`,
    author: 'octocat',
    changedFiles: 1,
    additions: 1,
    deletions: 0,
    files: [],
    checks: [],
    reviewDecision: 'approved',
    mergeability: 'mergeable',
    commentsCount: 0,
    reviewsCount: 0,
    reviewThreadsCount: 0,
    unresolvedReviewThreadsCount: 0,
    merge: { allowed: true, reason: null, methods: ['merge', 'squash'] },
  }
}

function panel(url: string) {
  return (
    <ChangeRequestPanel
      sessionId={url.endsWith('/8') ? 'session-b' : 'session-a'}
      workingPath={WorkingPath(url.endsWith('/8') ? '/repo/b' : '/repo/a')}
      requestUrl={url}
      open
      onClose={vi.fn()}
      onSelectRequest={vi.fn()}
      onOpenDiff={vi.fn()}
    />
  )
}

function deferred<T>() {
  let settle: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return {
    promise,
    resolve(value: T) {
      if (!settle) throw new Error('Deferred promise was not initialized.')
      settle(value)
    },
  }
}

describe('ChangeRequestPanel identity', () => {
  beforeEach(() => {
    apiMocks.getPanel.mockReset().mockImplementation(async (_sessionId, _path, url: string) => ({
      ok: true,
      snapshot: {
        provider: { id: 'github', host: 'github.com' },
        currentRef: details(url).headRef,
        selected: details(url),
        changeRequests: [details(url)],
      },
    }))
    apiMocks.merge.mockReset().mockResolvedValue({
      ok: true,
      changeRequest: { ...details('https://github.com/o/r/pull/7'), state: 'merged' },
    })
  })

  it('resets completed merge state when the bound request changes', async () => {
    const view = renderWithQueryClient(panel('https://github.com/o/r/pull/7'))
    await screen.findByRole('heading', { name: 'Request 7' })
    fireEvent.change(screen.getByLabelText('Merge method'), { target: { value: 'squash' } })
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    expect(await screen.findByText('Merge completed.')).toBeInTheDocument()

    view.rerender(
      <QueryClientProvider client={view.client}>
        {panel('https://github.com/o/r/pull/8')}
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Request 8' })).toBeInTheDocument()
    expect(screen.queryByText('Merge completed.')).toBeNull()
    expect(screen.getByLabelText('Merge method')).toHaveValue('merge')
  })

  it('ignores a previous request merge that finishes after the identity changes', async () => {
    const pending = deferred<MergeChangeRequestResult>()
    apiMocks.merge.mockReturnValue(pending.promise)
    const view = renderWithQueryClient(panel('https://github.com/o/r/pull/7'))
    await screen.findByRole('heading', { name: 'Request 7' })
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(apiMocks.merge).toHaveBeenCalledOnce())

    view.rerender(
      <QueryClientProvider client={view.client}>
        {panel('https://github.com/o/r/pull/8')}
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Request 8' })).toBeInTheDocument()

    await act(async () => {
      pending.resolve({
        ok: true,
        changeRequest: { ...details('https://github.com/o/r/pull/7'), state: 'merged' },
      })
      await pending.promise
    })

    expect(screen.queryByText('Merge completed.')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Request 8' })).toBeInTheDocument()
  })
})
