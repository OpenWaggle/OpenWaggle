import { SessionId } from '@shared/types/brand'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStatusStore } from '@/features/sessions/state'
import { mergeExactTerminalCounts, type SidebarRowState } from '../../lib/sidebar-row-state'
import { useSidebarTerminalCounts } from '../useSidebarTerminalCounts'

const { queryCountsMock, persistReceiptMock } = vi.hoisted(() => ({
  queryCountsMock: vi.fn(),
  persistReceiptMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: { updateSessionTreeUiState: persistReceiptMock },
}))

vi.mock('../remote-sidebar-session-query', () => ({
  queryTerminalSidebarCounts: queryCountsMock,
}))

describe('useSidebarTerminalCounts', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    persistReceiptMock.mockResolvedValue(undefined)
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      statusUpdatedAt: new Map(),
      lastVisitedAt: new Map(),
      terminalReceiptRevision: 0,
      phases: new Map(),
    })
  })

  it('falls back to local row counts when a refreshed Host count fails', async () => {
    queryCountsMock
      .mockResolvedValueOnce({
        refreshKey: 'session-a:completed\u00010',
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
      refreshKey: 'session-a:completed\u0000session-b:error\u00010',
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

  it('refreshes the exact count after a terminal read receipt reaches the Host', async () => {
    const persisted = Promise.withResolvers<void>()
    persistReceiptMock.mockReturnValueOnce(persisted.promise)
    queryCountsMock
      .mockResolvedValueOnce({
        refreshKey: 'session-a:completed\u00010',
        counts: { completed: 1, error: 0 },
      })
      .mockResolvedValueOnce({
        refreshKey: '\u00010',
        counts: { completed: 1, error: 0 },
      })
      .mockResolvedValueOnce({
        refreshKey: '\u00011',
        counts: { completed: 0, error: 0 },
      })
    const sessionId = SessionId('session-a')
    useSessionStatusStore.getState().setStatus(sessionId, 'completed', 1)
    const { result, rerender } = renderHook(
      ({ states }: { states: ReadonlyMap<string, SidebarRowState> }) =>
        useSidebarTerminalCounts(states),
      {
        initialProps: {
          states: new Map<string, SidebarRowState>([['session-a', 'completed']]),
        },
      },
    )
    await waitFor(() => expect(result.current.terminalCounts).toEqual({ completed: 1, error: 0 }))

    act(() => useSessionStatusStore.getState().markVisited(sessionId))
    rerender({ states: new Map<string, SidebarRowState>() })
    await waitFor(() => expect(queryCountsMock).toHaveBeenCalledTimes(2))
    expect(result.current.terminalCounts).toEqual({ completed: 1, error: 0 })
    expect(useSessionStatusStore.getState().terminalReceiptRevision).toBe(0)

    await act(async () => persisted.resolve())
    await waitFor(() => expect(queryCountsMock).toHaveBeenCalledTimes(3))
    expect(queryCountsMock).toHaveBeenNthCalledWith(3, '\u00011')
    expect(result.current.terminalCounts).toEqual({ completed: 0, error: 0 })
  })

  it('refreshes the exact count after marking a terminal Session unread', async () => {
    const persisted = Promise.withResolvers<void>()
    persistReceiptMock.mockReturnValueOnce(persisted.promise)
    queryCountsMock
      .mockResolvedValueOnce({ refreshKey: '\u00010', counts: { completed: 0, error: 0 } })
      .mockResolvedValueOnce({
        refreshKey: 'session-a:completed\u00010',
        counts: { completed: 0, error: 0 },
      })
      .mockResolvedValueOnce({
        refreshKey: 'session-a:completed\u00011',
        counts: { completed: 1, error: 0 },
      })
    const sessionId = SessionId('session-a')
    useSessionStatusStore.getState().setStatus(sessionId, 'completed', 1)
    useSessionStatusStore.setState({ lastVisitedAt: new Map([[sessionId, 2]]) })
    const { result, rerender } = renderHook(
      ({ states }: { states: ReadonlyMap<string, SidebarRowState> }) =>
        useSidebarTerminalCounts(states),
      { initialProps: { states: new Map<string, SidebarRowState>() } },
    )
    await waitFor(() => expect(result.current.terminalCounts).toEqual({ completed: 0, error: 0 }))

    act(() => useSessionStatusStore.getState().markUnread(sessionId))
    rerender({ states: new Map<string, SidebarRowState>([['session-a', 'completed']]) })
    await waitFor(() => expect(queryCountsMock).toHaveBeenCalledTimes(2))
    expect(result.current.terminalCounts).toEqual({ completed: 0, error: 0 })

    await act(async () => persisted.resolve())
    await waitFor(() => expect(queryCountsMock).toHaveBeenCalledTimes(3))
    expect(result.current.terminalCounts).toEqual({ completed: 1, error: 0 })
  })
})
