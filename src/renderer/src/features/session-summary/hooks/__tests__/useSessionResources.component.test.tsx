import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sessionResourcesQueryKey,
  sessionResourcesQueryOptions,
  useSessionResourceInvalidation,
  useSessionResources,
} from '../useSessionResources'

const resourceMocks = vi.hoisted(() => ({
  list: vi.fn(),
  advanceBackfill: vi.fn(),
  onResourcesInvalidated: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources: resourceMocks.list,
    advanceSessionResourceBackfill: resourceMocks.advanceBackfill,
    onSessionResourcesInvalidated: resourceMocks.onResourcesInvalidated,
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

  it('stops a no-progress backfill loop with a retryable query error', async () => {
    resourceMocks.list.mockResolvedValue({ resources: [], backfillComplete: false })
    resourceMocks.advanceBackfill.mockResolvedValue({
      backfillComplete: false,
      progressed: false,
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = sessionResourcesQueryOptions('session-one')

    await client.fetchQuery(options)
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await client.fetchQuery(options)
    }
    await expect(client.fetchQuery(options)).rejects.toThrow(
      'Historical session resource indexing stalled',
    )
    expect(resourceMocks.advanceBackfill).toHaveBeenCalledTimes(5)
  })

  it('stops observer polling after the terminal no-progress error', async () => {
    vi.useFakeTimers()
    try {
      resourceMocks.list.mockResolvedValue({ resources: [], backfillComplete: false })
      resourceMocks.advanceBackfill.mockResolvedValue({
        backfillComplete: false,
        progressed: false,
      })
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
      const { result } = renderHook(() => useSessionResources('session-one'), { wrapper })

      await act(async () => {
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(5_000)
      })
      expect(result.current.isError).toBe(true)
      expect(resourceMocks.advanceBackfill).toHaveBeenCalledTimes(5)

      await act(async () => vi.advanceTimersByTimeAsync(10_000))
      expect(resourceMocks.advanceBackfill).toHaveBeenCalledTimes(5)
    } finally {
      vi.useRealTimers()
    }
  })

  it('allows more than five bounded passes while each pass records progress', async () => {
    resourceMocks.list
      .mockResolvedValueOnce({ resources: [], backfillComplete: false })
      .mockResolvedValueOnce({ resources: [RESOURCE], backfillComplete: true })
    resourceMocks.advanceBackfill
      .mockResolvedValue({ backfillComplete: false, progressed: true })
      .mockResolvedValueOnce({ backfillComplete: false, progressed: true })
      .mockResolvedValueOnce({ backfillComplete: false, progressed: true })
      .mockResolvedValueOnce({ backfillComplete: false, progressed: true })
      .mockResolvedValueOnce({ backfillComplete: false, progressed: true })
      .mockResolvedValueOnce({ backfillComplete: false, progressed: true })
      .mockResolvedValueOnce({ backfillComplete: false, progressed: true })
      .mockResolvedValueOnce({ backfillComplete: true, progressed: true })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = sessionResourcesQueryOptions('session-one')

    await client.fetchQuery(options)
    for (let pass = 0; pass < 6; pass += 1) await client.fetchQuery(options)

    await expect(client.fetchQuery(options)).resolves.toMatchObject({ resources: [RESOURCE] })
    expect(resourceMocks.advanceBackfill).toHaveBeenCalledTimes(7)
  })
})
