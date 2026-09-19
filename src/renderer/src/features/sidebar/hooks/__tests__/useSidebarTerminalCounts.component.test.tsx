import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeExactTerminalCounts, type SidebarRowState } from '../../lib/sidebar-row-state'
import { useSidebarTerminalCounts } from '../useSidebarTerminalCounts'

const { queryCountsMock } = vi.hoisted(() => ({ queryCountsMock: vi.fn() }))

vi.mock('../remote-sidebar-session-query', () => ({
  queryTerminalSidebarCounts: queryCountsMock,
}))

describe('useSidebarTerminalCounts', () => {
  beforeEach(() => vi.resetAllMocks())

  it('falls back to local row counts when a refreshed Host count fails', async () => {
    queryCountsMock
      .mockResolvedValueOnce({
        refreshKey: 'session-a:completed',
        counts: { completed: 8, error: 2 },
      })
      .mockRejectedValueOnce(new Error('Host unavailable'))

    const { result, rerender } = renderHook(
      ({ states }: { states: ReadonlyMap<string, SidebarRowState> }) =>
        useSidebarTerminalCounts(states),
      {
        initialProps: {
          states: new Map<string, SidebarRowState>([['session-a', 'completed']]),
        },
      },
    )
    await waitFor(() => expect(result.current.terminalCounts).toEqual({ completed: 8, error: 2 }))

    rerender({
      states: new Map<string, SidebarRowState>([
        ['session-a', 'completed'],
        ['session-b', 'error'],
      ]),
    })
    await waitFor(() => expect(result.current.terminalCounts).toEqual({}))
    expect(
      mergeExactTerminalCounts(
        [
          { state: 'completed', count: 1 },
          { state: 'error', count: 1 },
        ],
        result.current.terminalCounts,
      ),
    ).toEqual([
      { state: 'error', count: 1 },
      { state: 'completed', count: 1 },
    ])
  })

  it('does not clear newer counts when an older request fails late', async () => {
    const staleRequest = Promise.withResolvers<never>()
    queryCountsMock.mockReturnValueOnce(staleRequest.promise).mockResolvedValueOnce({
      refreshKey: 'session-a:completed\u0000session-b:error',
      counts: { completed: 4, error: 3 },
    })

    const { result, rerender } = renderHook(
      ({ states }: { states: ReadonlyMap<string, SidebarRowState> }) =>
        useSidebarTerminalCounts(states),
      {
        initialProps: {
          states: new Map<string, SidebarRowState>([['session-a', 'completed']]),
        },
      },
    )
    await waitFor(() => expect(queryCountsMock).toHaveBeenCalledTimes(1))
    rerender({
      states: new Map<string, SidebarRowState>([
        ['session-a', 'completed'],
        ['session-b', 'error'],
      ]),
    })
    await waitFor(() => expect(result.current.terminalCounts).toEqual({ completed: 4, error: 3 }))

    await act(async () => staleRequest.reject(new Error('old Host request failed')))
    expect(result.current.terminalCounts).toEqual({ completed: 4, error: 3 })
  })
})
