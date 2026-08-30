import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionResourceRunCompletion, useSessionResources } from '../useSessionResources'

const resourceMocks = vi.hoisted(() => ({
  list: vi.fn(),
  onRunCompleted: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources: resourceMocks.list,
    onRunCompleted: resourceMocks.onRunCompleted,
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
    resourceMocks.onRunCompleted.mockReset()
  })

  it('refreshes the opened session catalog when its run captures new resources', async () => {
    let listener: ((payload: { readonly sessionId: SessionId }) => void) | undefined
    resourceMocks.onRunCompleted.mockImplementation((next) => {
      listener = next
      return () => {
        listener = undefined
      }
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => {
        useSessionResourceRunCompletion('session-one')
        return useSessionResources('session-one')
      },
      { wrapper },
    )
    await waitFor(() => expect(result.current.data).toEqual([]))
    expect(resourceMocks.onRunCompleted).toHaveBeenCalledOnce()

    resourceMocks.list.mockResolvedValue([RESOURCE])
    act(() => listener?.({ sessionId: SessionId('session-one') }))

    await waitFor(() => expect(result.current.data).toEqual([RESOURCE]))
    expect(resourceMocks.list).toHaveBeenCalledTimes(2)
  })

  it('ignores completion events from another session', async () => {
    let listener: ((payload: { readonly sessionId: SessionId }) => void) | undefined
    resourceMocks.onRunCompleted.mockImplementation((next) => {
      listener = next
      return () => undefined
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    renderHook(
      () => {
        useSessionResourceRunCompletion('session-one')
        return useSessionResources('session-one')
      },
      { wrapper },
    )
    await waitFor(() => expect(resourceMocks.list).toHaveBeenCalledOnce())

    act(() => listener?.({ sessionId: SessionId('session-two') }))
    expect(resourceMocks.list).toHaveBeenCalledOnce()
  })

  it('does not add a run-completion listener for every catalog consumer', async () => {
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
    expect(resourceMocks.onRunCompleted).not.toHaveBeenCalled()
  })

  it('continues bounded historical backfill until the session catalog is complete', async () => {
    resourceMocks.list
      .mockResolvedValueOnce({ resources: [], backfillComplete: false })
      .mockResolvedValueOnce({ resources: [RESOURCE], backfillComplete: true })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useSessionResources('session-one'), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual([RESOURCE]))
    expect(resourceMocks.list).toHaveBeenCalledTimes(2)
  })
})
