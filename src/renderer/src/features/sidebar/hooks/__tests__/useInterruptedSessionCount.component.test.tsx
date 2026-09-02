import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInterruptedSessionCount } from '../useInterruptedSessionCount'

const apiMocks = vi.hoisted(() => ({ querySessionControl: vi.fn() }))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

describe('interrupted Session chip count', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the exact Host-side count beyond the loaded catalog window', async () => {
    apiMocks.querySessionControl.mockResolvedValue({
      contractVersion: 2,
      requestId: 'interrupted-count',
      outcome: {
        operation: 'list',
        sessions: [],
        totalCount: 129,
      },
    })

    const { result } = renderHook(() => useInterruptedSessionCount([]))

    await waitFor(() => expect(result.current).toBe(129))
    expect(apiMocks.querySessionControl).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          operation: 'list',
          interrupted: true,
          archived: false,
        }),
      }),
    )
  })
})
