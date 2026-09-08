import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionImageResourcesByNodeIds } from '../useSessionMessageResources'
import { RESOURCE } from './session-resource-hook.test-fixtures'

const resourceMocks = vi.hoisted(() => ({
  nodePage: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResourceNodePage: resourceMocks.nodePage,
  },
}))

function testWrapper(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return {
    promise,
    resolve(value: T) {
      if (!resolve) throw new Error('Deferred query was not initialized.')
      resolve(value)
    },
  }
}

describe('useSessionImageResourcesByNodeIds', () => {
  beforeEach(() => {
    resourceMocks.nodePage.mockReset().mockResolvedValue({
      resources: [],
      total: 0,
      nextCursor: null,
      orderRevision: 'none',
    })
  })

  it('reuses completed node chunks when the transcript grows', async () => {
    const initialNodeIds = Array.from({ length: 128 }, (_, index) => `node-${String(index)}`)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender, result } = renderHook(
      ({ nodeIds }: { readonly nodeIds: readonly string[] }) =>
        useSessionImageResourcesByNodeIds('session-one', nodeIds),
      {
        initialProps: { nodeIds: initialNodeIds },
        wrapper: testWrapper(client),
      },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(resourceMocks.nodePage).toHaveBeenCalledTimes(2)
    const initialData = result.current.data

    rerender({ nodeIds: [...initialNodeIds] })
    expect(result.current.data).toBe(initialData)
    expect(resourceMocks.nodePage).toHaveBeenCalledTimes(2)

    rerender({ nodeIds: [...initialNodeIds, 'node-128'] })

    await waitFor(() => expect(resourceMocks.nodePage).toHaveBeenCalledTimes(3))
    expect(resourceMocks.nodePage.mock.calls[2]?.[1].nodeIds).toEqual(['node-128'])
  })

  it('retains a growing tail without carrying images across a changed transcript path', async () => {
    const growingTail = deferred<{
      resources: never[]
      total: number
      nextCursor: null
      orderRevision: string
    }>()
    const changedPath = deferred<{
      resources: never[]
      total: number
      nextCursor: null
      orderRevision: string
    }>()
    resourceMocks.nodePage.mockImplementation((_sessionId, input) => {
      if (input.nodeIds[0] === 'other-0') return changedPath.promise
      if (input.nodeIds.length === 64) return growingTail.promise
      return Promise.resolve({
        resources: [
          {
            ...RESOURCE,
            occurrences: [
              {
                id: 'occurrence-one',
                nodeId: 'node-0',
                branchId: null,
                actor: 'user' as const,
                activity: 'provided' as const,
                label: null,
                locator: '/images/output.png',
                createdAt: 1,
              },
            ],
          },
        ],
        total: 1,
        nextCursor: null,
        orderRevision: 'one',
      })
    })
    const initialNodeIds = Array.from({ length: 63 }, (_, index) => `node-${String(index)}`)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender, result } = renderHook(
      ({ nodeIds }: { readonly nodeIds: readonly string[] }) =>
        useSessionImageResourcesByNodeIds('session-one', nodeIds),
      {
        initialProps: { nodeIds: initialNodeIds },
        wrapper: testWrapper(client),
      },
    )
    await waitFor(() => expect(result.current.data).toHaveLength(1))

    rerender({ nodeIds: [...initialNodeIds, 'node-63'] })
    expect(result.current.data).toHaveLength(1)

    rerender({ nodeIds: ['other-0'] })
    await waitFor(() => expect(result.current.isPending).toBe(true))
    expect(result.current.data).toEqual([])

    growingTail.resolve({ resources: [], total: 0, nextCursor: null, orderRevision: 'two' })
    changedPath.resolve({ resources: [], total: 0, nextCursor: null, orderRevision: 'three' })
  })

  it('releases obsolete Session permits and stops their pagination after a route switch', async () => {
    const sessionAPage = deferred<{
      resources: never[]
      total: number
      nextCursor: string
      orderRevision: string
    }>()
    resourceMocks.nodePage.mockImplementation((sessionId) => {
      if (sessionId === 'session-a') return sessionAPage.promise
      return Promise.resolve({
        resources: [],
        total: 0,
        nextCursor: null,
        orderRevision: 'session-b',
      })
    })
    const sessionANodeIds = Array.from({ length: 256 }, (_, index) => `a-${String(index)}`)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender, result } = renderHook(
      ({
        sessionId,
        nodeIds,
      }: {
        readonly sessionId: string
        readonly nodeIds: readonly string[]
      }) => useSessionImageResourcesByNodeIds(sessionId, nodeIds),
      {
        initialProps: { sessionId: 'session-a', nodeIds: sessionANodeIds },
        wrapper: testWrapper(client),
      },
    )
    await waitFor(
      () =>
        expect(
          resourceMocks.nodePage.mock.calls.filter(([sessionId]) => sessionId === 'session-a'),
        ).toHaveLength(4),
      { timeout: 2_000 },
    )

    rerender({ sessionId: 'session-b', nodeIds: ['b-0'] })

    await waitFor(() =>
      expect(resourceMocks.nodePage).toHaveBeenCalledWith(
        'session-b',
        expect.objectContaining({ nodeIds: ['b-0'] }),
      ),
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    sessionAPage.resolve({
      resources: [],
      total: 0,
      nextCursor: 'obsolete-next-page',
      orderRevision: 'session-a',
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(
      resourceMocks.nodePage.mock.calls.filter(([sessionId]) => sessionId === 'session-a'),
    ).toHaveLength(4)
  })
})
