import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sessionResourceBackfillQueryOptions,
  useSessionResourceBackfill,
} from '../useSessionResources'

const advanceBackfill = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: { advanceSessionResourceBackfill: advanceBackfill },
}))

function testWrapper(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useSessionResourceBackfill', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    advanceBackfill.mockReset()
  })

  afterEach(() => vi.useRealTimers())

  it('backs off and stops polling when historical projection cannot progress', async () => {
    advanceBackfill.mockResolvedValue({ backfillComplete: false, progressed: false })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderHook(() => useSessionResourceBackfill('session-one'), {
      wrapper: testWrapper(client),
    })

    await act(async () => vi.advanceTimersByTimeAsync(0))
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await act(async () => vi.advanceTimersByTimeAsync(2_500))
    }
    await act(async () => {
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(advanceBackfill).toHaveBeenCalledTimes(5)
    const state = client.getQueryState(sessionResourceBackfillQueryOptions('session-one').queryKey)
    expect(state).toMatchObject({ status: 'error' })
    expect(state?.error).toEqual(
      expect.objectContaining({
        message: 'Historical session resource indexing stalled. Retry to continue.',
      }),
    )
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(advanceBackfill).toHaveBeenCalledTimes(5)
  })
})
