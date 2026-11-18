import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useSessionResourceCatalog, useSessionResourceInvalidation } from '../useSessionResources'
import { RESOURCE } from './session-resource-hook.test-fixtures'

const catalogMocks = vi.hoisted(() => ({
  listPage: vi.fn(),
  onResourcesInvalidated: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResourcePage: catalogMocks.listPage,
    onSessionResourcesInvalidated: catalogMocks.onResourcesInvalidated,
  },
}))

describe('Session resource catalog invalidation', () => {
  it('marks background Session catalogs stale without fetching or changing the opened Session', async () => {
    let backgroundOutputs: readonly SessionResource[] = []
    let listener: ((payload: { readonly sessionId: SessionId }) => void) | undefined
    catalogMocks.listPage.mockReset().mockImplementation(async (sessionId) => ({
      resources: sessionId === 'session-one' ? backgroundOutputs : [],
      total: sessionId === 'session-one' ? backgroundOutputs.length : 0,
      nextCursor: null,
      orderRevision: 'revision-one',
    }))
    catalogMocks.onResourcesInvalidated.mockReset().mockImplementation((next) => {
      listener = next
      return () => {
        listener = undefined
      }
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    })
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result, rerender } = renderHook(
      ({ sessionId }) => {
        useSessionResourceInvalidation()
        return useSessionResourceCatalog(sessionId, 'outputs')
      },
      { initialProps: { sessionId: 'session-one' }, wrapper },
    )
    await waitFor(() => expect(result.current.total).toBe(0))
    await waitFor(() => expect(catalogMocks.listPage).toHaveBeenCalledTimes(1))
    rerender({ sessionId: 'session-two' })
    await waitFor(() => expect(catalogMocks.listPage).toHaveBeenCalledTimes(2))
    backgroundOutputs = [{ ...RESOURCE, id: 'background-output', isSource: false, isOutput: true }]
    act(() => listener?.({ sessionId: SessionId('session-one') }))
    expect(result.current.resources).toEqual([])
    expect(catalogMocks.listPage).toHaveBeenCalledTimes(2)
    rerender({ sessionId: 'session-one' })
    await waitFor(() => expect(result.current.resources).toEqual(backgroundOutputs))
    expect(catalogMocks.listPage).toHaveBeenCalledTimes(3)
    expect(catalogMocks.onResourcesInvalidated).toHaveBeenCalledOnce()
  })

  it('refreshes an already-open Session catalog when a durable Output wakes it', async () => {
    let resources: readonly SessionResource[] = []
    let listener: ((payload: { readonly sessionId: SessionId }) => void) | undefined
    catalogMocks.listPage.mockReset().mockImplementation(async () => ({
      resources,
      total: resources.length,
      nextCursor: null,
      orderRevision: 'revision-one',
    }))
    catalogMocks.onResourcesInvalidated.mockImplementation((next) => {
      listener = next
      return () => {
        listener = undefined
      }
    })
    const output = { ...RESOURCE, id: 'output-one', isSource: false, isOutput: true }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () => {
        useSessionResourceInvalidation()
        return useSessionResourceCatalog('session-one', 'outputs')
      },
      { wrapper },
    )
    await waitFor(() => expect(result.current.resources).toEqual([]))

    resources = [output]
    act(() => listener?.({ sessionId: SessionId('session-one') }))

    await waitFor(() => expect(result.current.resources).toEqual([output]))
    expect(catalogMocks.listPage).toHaveBeenCalledTimes(2)
  })
})
