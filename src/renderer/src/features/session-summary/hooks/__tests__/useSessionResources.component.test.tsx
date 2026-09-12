import { SessionId } from '@shared/types/brand'
import type {
  SessionResource,
  SessionResourceNodePageRequest,
} from '@shared/types/session-resource'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sessionResourcesQueryOptions,
  useSessionImageResourcesByNodeIds,
  useSessionResourceCatalog,
  useSessionResourceInvalidation,
  useSessionResources,
} from '../useSessionResources'
import { RESOURCE } from './session-resource-hook.test-fixtures'

const resourceMocks = vi.hoisted(() => ({
  list: vi.fn(),
  advanceBackfill: vi.fn(),
  onResourcesInvalidated: vi.fn(),
  nodePage: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources: resourceMocks.list,
    advanceSessionResourceBackfill: resourceMocks.advanceBackfill,
    onSessionResourcesInvalidated: resourceMocks.onResourcesInvalidated,
    listSessionResourceNodePage: resourceMocks.nodePage,
  },
}))

describe('useSessionResources', () => {
  beforeEach(() => {
    resourceMocks.list.mockReset().mockResolvedValue([])
    resourceMocks.advanceBackfill.mockReset().mockResolvedValue({ backfillComplete: true })
    resourceMocks.onResourcesInvalidated.mockReset()
    resourceMocks.nodePage.mockReset().mockResolvedValue({
      resources: [],
      total: 0,
      nextCursor: null,
      orderRevision: 'none',
    })
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
        useSessionResourceInvalidation()
        return useSessionResources('session-one')
      },
      { wrapper },
    )
    await waitFor(() => expect(result.current.data).toEqual([]))
    expect(resourceMocks.onResourcesInvalidated).toHaveBeenCalledOnce()

    resourceMocks.list.mockResolvedValue([RESOURCE])
    act(() => listener?.({ sessionId: SessionId('session-one') }))

    await waitFor(() => expect(result.current.data).toEqual([RESOURCE]))
    expect(invalidate).toHaveBeenCalledWith({ predicate: expect.any(Function) })
    expect(resourceMocks.list).toHaveBeenCalledTimes(2)
  })

  it('does not refetch the opened Session for another Session invalidation', async () => {
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
        useSessionResourceInvalidation()
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

  it('filters the legacy catalog fallback to change-request resources', async () => {
    const changeRequest: SessionResource = {
      ...RESOURCE,
      id: 'change-request-one',
      canonicalKey: 'url:https://github.example/pull/42',
      kind: 'change-request',
      title: 'Pull request 42',
      mimeType: null,
      locator: 'https://github.example/pull/42',
      managed: false,
    }
    const sourceChangeRequest: SessionResource = {
      ...changeRequest,
      id: 'source-change-request',
      canonicalKey: 'url:https://github.example/pull/7',
      isSource: true,
      isOutput: false,
    }
    resourceMocks.list.mockResolvedValue({
      resources: [RESOURCE, sourceChangeRequest, changeRequest],
      backfillComplete: true,
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () => useSessionResourceCatalog('session-one', 'change-requests'),
      { wrapper },
    )

    await waitFor(() => expect(result.current.resources).toEqual([changeRequest]))
    expect(result.current.total).toBe(1)
  })

  it('loads and deduplicates more than 512 node-scoped images in bounded pages', async () => {
    const nodeIds = Array.from({ length: 600 }, (_, index) => `node-${String(index)}`)
    let inFlight = 0
    let maxInFlight = 0
    const imageForNode = (nodeId: string, suffix: string): SessionResource => ({
      ...RESOURCE,
      id: `image-${nodeId}-${suffix}`,
      canonicalKey: `sha256:${nodeId}-${suffix}`,
      title: `${nodeId}-${suffix}.png`,
      occurrences: [
        {
          id: `occurrence-${nodeId}-${suffix}`,
          nodeId,
          branchId: null,
          actor: 'agent',
          activity: 'created',
          label: null,
          locator: `/images/${nodeId}-${suffix}.png`,
          createdAt: Number(nodeId.slice('node-'.length)),
        },
      ],
    })
    resourceMocks.nodePage.mockImplementation(
      async (_sessionId: SessionId, input: SessionResourceNodePageRequest) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 0))
        const shared: SessionResource = {
          ...RESOURCE,
          id: 'shared-image',
          canonicalKey: 'sha256:shared-image',
          title: 'shared.png',
          occurrences: input.nodeIds.map((nodeId) => ({
            id: `shared-${nodeId}`,
            nodeId,
            branchId: null,
            actor: 'agent' as const,
            activity: 'created' as const,
            label: null,
            locator: '/images/shared.png',
            createdAt: Number(nodeId.slice('node-'.length)),
          })),
        }
        const matching = [
          ...input.nodeIds.flatMap((nodeId) => [
            imageForNode(nodeId, 'a'),
            imageForNode(nodeId, 'b'),
          ]),
          shared,
        ]
        const offset = input.cursor ? Number(input.cursor) : 0
        const resources = matching.slice(offset, offset + input.limit)
        const nextOffset = offset + resources.length
        inFlight -= 1
        return {
          resources,
          total: matching.length,
          nextCursor: nextOffset < matching.length ? String(nextOffset) : null,
          orderRevision: 'revision-one',
        }
      },
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useSessionImageResourcesByNodeIds('session-one', nodeIds), {
      wrapper,
    })

    await waitFor(() => expect(result.current.data).toHaveLength(1_201))
    expect(resourceMocks.nodePage).toHaveBeenCalledTimes(19)
    expect(maxInFlight).toBe(4)
    expect(
      resourceMocks.nodePage.mock.calls.every(
        ([, input]) => input.nodeIds.length <= 64 && input.limit === 128,
      ),
    ).toBe(true)
    expect(result.current.data?.find(({ id }) => id === 'shared-image')?.occurrences).toHaveLength(
      600,
    )
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
