import type { SessionSummary } from '@shared/types/session'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStatusStore } from '@/features/sessions/state'
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

  it('asks the Host again only when the catalog’s interruptions change (boot fetch dedupe)', async () => {
    apiMocks.querySessionControl.mockResolvedValue({
      contractVersion: 2,
      requestId: 'interrupted-count',
      outcome: { operation: 'list', sessions: [], totalCount: 0 },
    })
    // A new array of the same (empty) catalog on every render, as startup produced.
    const noSessions = (): readonly SessionSummary[] => []
    const { rerender } = renderHook(({ sessions }) => useInterruptedSessionCount(sessions), {
      initialProps: { sessions: noSessions() },
    })
    rerender({ sessions: noSessions() })
    rerender({ sessions: noSessions() })

    await waitFor(() => expect(apiMocks.querySessionControl).toHaveBeenCalledTimes(1))
  })

  // PR 391 review R2 P3-7: an interruption in a Session beyond the loaded catalog changes neither
  // the catalog's length nor its interrupted ids, so the count went stale until it did.
  it('asks the Host again when it reports a change outside the loaded catalog', async () => {
    apiMocks.querySessionControl
      .mockResolvedValueOnce({
        contractVersion: 2,
        requestId: 'interrupted-count',
        outcome: { operation: 'list', sessions: [], totalCount: 3 },
      })
      .mockResolvedValueOnce({
        contractVersion: 2,
        requestId: 'interrupted-count',
        outcome: { operation: 'list', sessions: [], totalCount: 4 },
      })
    const sessions: readonly SessionSummary[] = []
    const { result } = renderHook(() => useInterruptedSessionCount(sessions))
    await waitFor(() => expect(result.current).toBe(3))

    act(() => useSessionStatusStore.getState().noteHostTerminalCountChange())

    await waitFor(() => expect(result.current).toBe(4))
    expect(apiMocks.querySessionControl).toHaveBeenCalledTimes(2)
  })
})
