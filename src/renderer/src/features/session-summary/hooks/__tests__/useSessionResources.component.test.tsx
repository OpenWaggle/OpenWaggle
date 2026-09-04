import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sessionResourcesQueryKey,
  useRecordSessionCommit,
  useSessionResourceInvalidation,
  useSessionResources,
} from '../useSessionResources'

const resourceMocks = vi.hoisted(() => ({
  list: vi.fn(),
  advanceBackfill: vi.fn(),
  onResourcesInvalidated: vi.fn(),
  recordCommit: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources: resourceMocks.list,
    advanceSessionResourceBackfill: resourceMocks.advanceBackfill,
    onSessionResourcesInvalidated: resourceMocks.onResourcesInvalidated,
    recordSessionCommit: resourceMocks.recordCommit,
  },
}))

const RESOURCE: SessionResource = {
  id: 'resource-one',
  sessionId: SessionId('session-one'),
  canonicalKey: 'sha256:one',
  kind: 'image',
  title: 'output.png',
  mimeType: 'image/png',
  locator: 'session-resource://resource-one',
  available: true,
  isSource: false,
  isOutput: true,
  occurrences: [],
  createdAt: 1,
  updatedAt: 1,
}

describe('useSessionResources', () => {
  beforeEach(() => {
    resourceMocks.list.mockReset().mockResolvedValue([])
    resourceMocks.advanceBackfill.mockReset().mockResolvedValue({ backfillComplete: true })
    resourceMocks.onResourcesInvalidated.mockReset()
    resourceMocks.recordCommit.mockReset().mockResolvedValue({})
  })

  it('refreshes only the opened Session catalog after resources change', async () => {
    let listener: ((payload: { readonly sessionId: SessionId }) => void) | undefined
    resourceMocks.onResourcesInvalidated.mockImplementation((next) => {
      listener = next
      return () => {
        listener = undefined
      }
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => {
        useSessionResourceInvalidation('session-one')
        return useSessionResources('session-one')
      },
      { wrapper },
    )
    await waitFor(() => expect(result.current.data).toEqual([]))
    expect(resourceMocks.onResourcesInvalidated).toHaveBeenCalledOnce()

    resourceMocks.list.mockResolvedValue([RESOURCE])
    act(() => listener?.({ sessionId: SessionId('session-one') }))

    await waitFor(() => expect(result.current.data).toEqual([RESOURCE]))
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: sessionResourcesQueryKey('session-one'),
      exact: true,
    })
    expect(resourceMocks.list).toHaveBeenCalledTimes(2)
  })

  it('ignores resource invalidations from another Session', async () => {
    let listener: ((payload: { readonly sessionId: SessionId }) => void) | undefined
    resourceMocks.onResourcesInvalidated.mockImplementation((next) => {
      listener = next
      return () => undefined
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    renderHook(
      () => {
        useSessionResourceInvalidation('session-one')
        return useSessionResources('session-one')
      },
      { wrapper },
    )
    await waitFor(() => expect(resourceMocks.list).toHaveBeenCalledOnce())

    act(() => listener?.({ sessionId: SessionId('session-two') }))
    expect(resourceMocks.list).toHaveBeenCalledOnce()
  })

  it('does not add an invalidation listener for every catalog consumer', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    renderHook(
      () => {
        useSessionResources('session-one')
        useSessionResources('session-one')
      },
      { wrapper },
    )

    await waitFor(() => expect(resourceMocks.list).toHaveBeenCalledOnce())
    expect(resourceMocks.onResourcesInvalidated).not.toHaveBeenCalled()
  })

  it('continues bounded historical backfill until the session catalog is complete', async () => {
    resourceMocks.list
      .mockResolvedValueOnce({ resources: [], backfillComplete: false })
      .mockResolvedValueOnce({ resources: [RESOURCE], backfillComplete: true })
    resourceMocks.advanceBackfill
      .mockResolvedValueOnce({ backfillComplete: false })
      .mockResolvedValueOnce({ backfillComplete: true })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useSessionResources('session-one'), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual([RESOURCE]))
    expect(resourceMocks.list).toHaveBeenCalledTimes(2)
    expect(resourceMocks.advanceBackfill).toHaveBeenCalledTimes(2)
  })

  it('records and invalidates a commit only for its owning session', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useRecordSessionCommit(SessionId('session-one'), client), {
      wrapper,
    })
    const commit = {
      commitHash: '0123456789abcdef0123456789abcdef01234567',
      title: 'Record this commit',
    }

    await act(() => result.current(commit))

    expect(resourceMocks.recordCommit).toHaveBeenCalledWith(SessionId('session-one'), commit)
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: sessionResourcesQueryKey('session-one'),
      exact: true,
    })
    expect(invalidate).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: sessionResourcesQueryKey('session-two') }),
    )
  })

  it('does not record a commit when no session owns the action', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useRecordSessionCommit(null, client), { wrapper })

    await act(() =>
      result.current({
        commitHash: '0123456789abcdef0123456789abcdef01234567',
        title: 'Unowned commit',
      }),
    )

    expect(resourceMocks.recordCommit).not.toHaveBeenCalled()
  })
})
