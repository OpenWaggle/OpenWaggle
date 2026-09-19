import type { SessionId } from '@shared/types/brand'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStatusStore } from '@/features/sessions/state'
import { useRemoteSidebarSessions } from '../useRemoteSidebarSessions'
import { useSidebarRowStates } from '../useSidebarRowStates'
import { hookInput, listResponse, summary } from './useRemoteSidebarSessions.test-support'

const apiMocks = vi.hoisted(() => ({
  listSessionsByIds: vi.fn(),
  querySessionControl: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

describe('remote terminal Session filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      statusUpdatedAt: new Map(),
      lastVisitedAt: new Map(),
      phases: new Map(),
    })
    apiMocks.querySessionControl.mockImplementation(async () => listResponse([], { totalCount: 0 }))
    apiMocks.listSessionsByIds.mockResolvedValue([])
  })

  it('paginates and hydrates every unread failure after renderer restart', async () => {
    const remote = Array.from({ length: 250 }, (_, index) => ({
      ...summary(`failed-${String(index).padStart(3, '0')}`, `Failed ${String(index)}`),
      latestRun: { status: 'failed' as const, updatedAt: index + 1 },
    }))
    apiMocks.querySessionControl.mockImplementation(async (request) => {
      if (request.query.unreadTerminalStatus === 'completed') {
        return listResponse([], { totalCount: 7 })
      }
      if (request.query.unreadTerminalStatus === 'failed') {
        if (request.query.limit === 1) return listResponse([], { totalCount: remote.length })
        return request.query.cursor
          ? listResponse(remote.slice(200))
          : listResponse(remote.slice(0, 200), {
              totalCount: remote.length,
              nextCursor: 'failed-page-2',
            })
      }
      return listResponse([])
    })
    apiMocks.listSessionsByIds.mockImplementation(async (ids: readonly SessionId[]) =>
      remote.filter((session) => ids.includes(session.id)),
    )

    const { result } = renderHook(() => {
      const rowStates = useSidebarRowStates([], 0)
      return useRemoteSidebarSessions(
        hookInput({ filterState: 'error', stateBySessionId: rowStates.stateBySessionId }),
      )
    })
    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(200)
      expect(result.current.hasMore).toBe(true)
      expect(result.current.terminalCounts).toEqual({ completed: 7, error: 250 })
    })

    act(() => {
      result.current.loadMore()
      result.current.loadMore()
    })
    await waitFor(() => expect(result.current.sessions).toHaveLength(250))
    const failedPages = apiMocks.querySessionControl.mock.calls.filter(
      ([request]) => request.query.unreadTerminalStatus === 'failed' && request.query.limit !== 1,
    )
    expect(failedPages).toHaveLength(2)
    expect(apiMocks.listSessionsByIds).toHaveBeenCalledTimes(3)
  })

  it('keeps the Completed cursor while hydrated statuses enter the local row-state map', async () => {
    const remote = Array.from({ length: 201 }, (_, index) => ({
      ...summary(`completed-${String(index).padStart(3, '0')}`, `Completed ${String(index)}`),
      latestRun: { status: 'completed' as const, updatedAt: index + 1 },
    }))
    apiMocks.querySessionControl.mockImplementation(async (request) => {
      if (request.query.unreadTerminalStatus !== 'completed') {
        return listResponse([], { totalCount: 0 })
      }
      if (request.query.limit === 1) return listResponse([], { totalCount: remote.length })
      return request.query.cursor
        ? listResponse(remote.slice(200))
        : listResponse(remote.slice(0, 200), {
            totalCount: remote.length,
            nextCursor: 'completed-page-2',
          })
    })
    apiMocks.listSessionsByIds.mockImplementation(async (ids: readonly SessionId[]) =>
      remote.filter((session) => ids.includes(session.id)),
    )

    const { result } = renderHook(() => {
      const rowStates = useSidebarRowStates([remote[0]], 0)
      return useRemoteSidebarSessions(
        hookInput({
          filterState: 'completed',
          loadedSessions: [remote[0]],
          stateBySessionId: rowStates.stateBySessionId,
        }),
      )
    })
    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(200)
      expect(result.current.hasMore).toBe(true)
    })
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.sessions).toHaveLength(201))

    const completedPages = apiMocks.querySessionControl.mock.calls.filter(
      ([request]) =>
        request.query.unreadTerminalStatus === 'completed' && request.query.limit !== 1,
    )
    expect(completedPages).toHaveLength(2)
    expect(completedPages[1]?.[0].query.cursor).toBe('completed-page-2')
  })

  it('removes a visited remote terminal row without restarting pagination', async () => {
    const remote = Array.from({ length: 401 }, (_, index) => ({
      ...summary(`visited-${String(index).padStart(3, '0')}`, `Completed ${String(index)}`),
      latestRun: { status: 'completed' as const, updatedAt: index + 1 },
    }))
    useSessionStatusStore.getState().setStatus(remote[0].id, 'completed', 1)
    apiMocks.querySessionControl.mockImplementation(async (request) => {
      if (request.query.unreadTerminalStatus !== 'completed') return listResponse([])
      if (request.query.limit === 1) return listResponse([], { totalCount: remote.length })
      if (request.query.cursor === 'completed-page-2') {
        return listResponse(remote.slice(200, 400), { nextCursor: 'completed-page-3' })
      }
      if (request.query.cursor === 'completed-page-3') return listResponse(remote.slice(400))
      return listResponse(remote.slice(0, 200), { nextCursor: 'completed-page-2' })
    })
    apiMocks.listSessionsByIds.mockImplementation(async (ids: readonly SessionId[]) =>
      remote.filter((session) => ids.includes(session.id)),
    )

    const { result } = renderHook(() => {
      const rowStates = useSidebarRowStates([], 0)
      return useRemoteSidebarSessions(
        hookInput({ filterState: 'completed', stateBySessionId: rowStates.stateBySessionId }),
      )
    })
    await waitFor(() => expect(result.current.sessions).toHaveLength(200))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.sessions).toHaveLength(400))

    act(() => useSessionStatusStore.getState().markVisited(remote[0].id))
    await waitFor(() => expect(result.current.sessions).toHaveLength(399))
    expect(result.current.sessions.some((session) => session.id === remote[0].id)).toBe(false)
    expect(result.current.hasMore).toBe(true)
    act(() => useSessionStatusStore.getState().markUnread(remote[0].id))
    await waitFor(() => expect(result.current.sessions).toHaveLength(400))
    expect(result.current.hasMore).toBe(true)
    act(() => useSessionStatusStore.getState().markVisited(remote[0].id))
    await waitFor(() => expect(result.current.sessions).toHaveLength(399))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.sessions).toHaveLength(400))
    const completedPages = apiMocks.querySessionControl.mock.calls.filter(
      ([request]) =>
        request.query.unreadTerminalStatus === 'completed' && request.query.limit !== 1,
    )
    expect(completedPages).toHaveLength(3)
    expect(completedPages[1]?.[0].query.cursor).toBe('completed-page-2')
    expect(completedPages[2]?.[0].query.cursor).toBe('completed-page-3')
  })

  it('discovers a new live terminal Session outside the loaded catalog', async () => {
    const remote = {
      ...summary('new-live-failure', 'New failure'),
      latestRun: { status: 'failed' as const, updatedAt: 1000 },
    }
    apiMocks.querySessionControl.mockImplementation(async (request) => {
      if (request.query.unreadTerminalStatus !== 'failed') return listResponse([])
      if (request.query.limit === 1) return listResponse([], { totalCount: 1 })
      return listResponse(
        useSessionStatusStore.getState().getStatus(remote.id) === 'error' ? [remote] : [],
      )
    })
    apiMocks.listSessionsByIds.mockResolvedValue([remote])

    const { result } = renderHook(() => {
      const rowStates = useSidebarRowStates([], 0)
      return useRemoteSidebarSessions(
        hookInput({ filterState: 'error', stateBySessionId: rowStates.stateBySessionId }),
      )
    })
    await waitFor(() => {
      expect(
        apiMocks.querySessionControl.mock.calls.filter(
          ([request]) =>
            request.query.unreadTerminalStatus === 'failed' && request.query.limit !== 1,
        ),
      ).toHaveLength(1)
    })

    act(() => useSessionStatusStore.getState().setStatus(remote.id, 'error', 1000))
    await waitFor(() => expect(result.current.sessions).toEqual([remote]))
    const failedPages = apiMocks.querySessionControl.mock.calls.filter(
      ([request]) => request.query.unreadTerminalStatus === 'failed' && request.query.limit !== 1,
    )
    expect(failedPages).toHaveLength(2)
  })

  it('ignores a stale terminal page when the selected chip changes mid-request', async () => {
    const completed = {
      ...summary('stale-completed', 'Completed first'),
      latestRun: { status: 'completed' as const, updatedAt: 1 },
    }
    const failed = {
      ...summary('current-failed', 'Failed next'),
      latestRun: { status: 'failed' as const, updatedAt: 2 },
    }
    let finishCompleted: (response: ReturnType<typeof listResponse>) => void = () => undefined
    const pendingCompleted = new Promise<ReturnType<typeof listResponse>>((resolve) => {
      finishCompleted = resolve
    })
    apiMocks.querySessionControl.mockImplementation(async (request) => {
      if (request.query.limit === 1) return listResponse([])
      if (request.query.unreadTerminalStatus === 'completed') return pendingCompleted
      if (request.query.unreadTerminalStatus === 'failed') return listResponse([failed])
      return listResponse([])
    })
    apiMocks.listSessionsByIds.mockImplementation(async (ids: readonly SessionId[]) =>
      [completed, failed].filter((session) => ids.includes(session.id)),
    )

    const { result, rerender } = renderHook(
      ({ showError }: { showError: boolean }) => {
        const rowStates = useSidebarRowStates([], 0)
        return useRemoteSidebarSessions(
          hookInput({
            filterState: showError ? 'error' : 'completed',
            stateBySessionId: rowStates.stateBySessionId,
          }),
        )
      },
      { initialProps: { showError: false } },
    )
    await waitFor(() =>
      expect(
        apiMocks.querySessionControl.mock.calls.some(
          ([request]) =>
            request.query.unreadTerminalStatus === 'completed' && request.query.limit !== 1,
        ),
      ).toBe(true),
    )

    rerender({ showError: true })
    await waitFor(() => expect(result.current.sessions).toEqual([failed]))
    await act(async () => {
      finishCompleted(listResponse([completed]))
      await pendingCompleted
    })
    expect(result.current.sessions).toEqual([failed])
  })
})
