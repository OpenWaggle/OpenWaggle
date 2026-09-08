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
  it('refreshes an already-open Session catalog when a durable Output wakes it', async () => {
    let resources: readonly SessionResource[] = []
    let listener: ((payload: { readonly sessionId: SessionId }) => void) | undefined
    catalogMocks.listPage.mockImplementation(async () => ({
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
        useSessionResourceInvalidation('session-one')
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
