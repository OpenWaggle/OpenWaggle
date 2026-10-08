import { SessionId } from '@shared/types/brand'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHookWithQueryClient } from '@/test-utils/query-test-utils'
import { queryKeys } from '../query-keys'
import { useSourceControlQueryFreshness } from '../source-control'

const mocks = vi.hoisted(() => ({
  onRunCompleted: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: { onRunCompleted: mocks.onRunCompleted } }))

describe('useSourceControlQueryFreshness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.onRunCompleted.mockReturnValue(mocks.unsubscribe)
  })

  it('invalidates source-control queries when a Run completes and on window focus', async () => {
    const first = renderHookWithQueryClient(() => useSourceControlQueryFreshness())
    const { client } = first
    // A second consumer shares the one subscription.
    renderHookWithQueryClient(() => useSourceControlQueryFreshness(), { client })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    expect(mocks.onRunCompleted).toHaveBeenCalledOnce()

    act(() => mocks.onRunCompleted.mock.calls[0]?.[0]?.({ sessionId: SessionId('s') }))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.sourceControl })
  })

  it('unsubscribes once no consumer is mounted', () => {
    const { client, unmount } = renderHookWithQueryClient(() => useSourceControlQueryFreshness())
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    unmount()
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(invalidate).not.toHaveBeenCalled()
  })
})
