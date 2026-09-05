import type { SessionId } from '@shared/types/brand'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStatusStore } from '@/features/sessions/state'
import { useRemoteSidebarSessions } from '../useRemoteSidebarSessions'
import { hookInput, listResponse, summary } from './useRemoteSidebarSessions.test-support'

const apiMocks = vi.hoisted(() => ({
  listSessionsByIds: vi.fn(),
  querySessionControl: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

describe('remote sidebar Session filtering', () => {
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

  it('finds a title beyond the loaded catalog page through one Host catalog query', async () => {
    const remote = summary('session-101', 'Needle Session')
    apiMocks.querySessionControl.mockImplementation(async (request) =>
      request.query.searchText === 'needle'
        ? listResponse([remote])
        : listResponse([], { totalCount: 0 }),
    )
    apiMocks.listSessionsByIds.mockResolvedValue([remote])

    const { result } = renderHook(() =>
      useRemoteSidebarSessions(
        hookInput({
          query: 'needle',
          loadedSessions: Array.from({ length: 100 }, (_, index) =>
            summary(`session-${index}`, `Loaded ${index}`),
          ),
        }),
      ),
    )

    await waitFor(() => expect(result.current.sessions).toEqual([remote]))
    const searchCalls = apiMocks.querySessionControl.mock.calls.filter(
      ([request]) => request.query.searchText === 'needle',
    )
    expect(searchCalls).toHaveLength(1)
    expect(apiMocks.listSessionsByIds).toHaveBeenCalledWith([remote.id])
  })

  it('paginates every matching title beyond the first Host search page', async () => {
    const remote = Array.from({ length: 350 }, (_, index) =>
      summary(`search-${String(index).padStart(3, '0')}`, `Needle ${String(index)}`),
    )
    apiMocks.querySessionControl.mockImplementation(async (request) => {
      if (request.query.searchText !== 'needle') return listResponse([])
      return request.query.cursor
        ? listResponse(remote.slice(200))
        : listResponse(remote.slice(0, 200), { nextCursor: 'search-page-2' })
    })
    apiMocks.listSessionsByIds.mockImplementation(async (ids: readonly SessionId[]) =>
      remote.filter((session) => ids.includes(session.id)),
    )

    const { result } = renderHook(() => useRemoteSidebarSessions(hookInput({ query: 'needle' })))

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(200)
      expect(result.current.hasMore).toBe(true)
    })
    act(() => result.current.loadMore())
    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(350)
      expect(result.current.hasMore).toBe(false)
    })
    const searchCalls = apiMocks.querySessionControl.mock.calls.filter(
      ([request]) => request.query.searchText === 'needle',
    )
    expect(searchCalls).toHaveLength(2)
    expect(searchCalls[1]?.[0].query.cursor).toBe('search-page-2')
  })

  it('keeps all-active hydration for a live status outside catalog pages', async () => {
    const remote = summary('session-working-101', 'Remote worker')
    apiMocks.listSessionsByIds.mockResolvedValue([remote])

    const { result } = renderHook(() =>
      useRemoteSidebarSessions(
        hookInput({
          filterState: 'working',
          stateBySessionId: new Map([[String(remote.id), 'working']]),
        }),
      ),
    )

    await waitFor(() => expect(result.current.sessions).toEqual([remote]))
    expect(
      apiMocks.querySessionControl.mock.calls.some(
        ([request]) => request.query.unreadTerminalStatus === undefined,
      ),
    ).toBe(false)
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

    const { result } = renderHook(() =>
      useRemoteSidebarSessions(hookInput({ filterState: 'error' })),
    )
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

  it('loads interrupted Sessions beyond one hydration batch', async () => {
    const remote = Array.from({ length: 129 }, (_, index) =>
      summary(`interrupted-${String(index)}`, `Interrupted ${String(index)}`),
    )
    apiMocks.querySessionControl.mockImplementation(async (request) =>
      request.query.interrupted === true
        ? listResponse(remote, { totalCount: remote.length })
        : listResponse([], { totalCount: 0 }),
    )
    apiMocks.listSessionsByIds.mockImplementation(async (ids: readonly SessionId[]) =>
      remote.filter((session) => ids.includes(session.id)),
    )

    const { result } = renderHook(() =>
      useRemoteSidebarSessions(hookInput({ filterState: 'interrupted' })),
    )

    await waitFor(() => expect(result.current.sessions).toHaveLength(129))
    expect(apiMocks.listSessionsByIds).toHaveBeenCalledTimes(2)
  })

  it('does not reintroduce an archived terminal Session', async () => {
    const archived = { ...summary('archived-error', 'Archived failure'), archived: true }
    apiMocks.querySessionControl.mockImplementation(async (request) =>
      request.query.unreadTerminalStatus === 'failed' && request.query.limit !== 1
        ? listResponse([archived], { totalCount: 1 })
        : listResponse([], { totalCount: 0 }),
    )
    apiMocks.listSessionsByIds.mockResolvedValue([archived])

    const { result } = renderHook(() =>
      useRemoteSidebarSessions(hookInput({ filterState: 'error' })),
    )

    await waitFor(() => expect(apiMocks.listSessionsByIds).toHaveBeenCalledOnce())
    expect(result.current.sessions).toEqual([])
  })

  it('keeps loaded text matches visible while Host discovery hydrates', () => {
    apiMocks.querySessionControl.mockReturnValue(new Promise(() => undefined))
    const local = summary('loaded-match', 'Plain Session')

    const { result } = renderHook(() =>
      useRemoteSidebarSessions(hookInput({ query: 'plain', loadedSessions: [local] })),
    )

    expect(result.current.sessions).toEqual([local])
  })

  it('paginates 1,000 matching aliases with at most two Host calls per page', async () => {
    const paths = Array.from({ length: 1_000 }, (_, index) => `/repo/project-${String(index)}`)
    const aliases = Object.fromEntries(paths.map((projectPath) => [projectPath, 'Needle alias']))
    const remote = Array.from({ length: 300 }, (_, index) =>
      summary(`alias-${String(index)}`, `Alias ${String(index)}`, paths[index] ?? paths[0]),
    )
    apiMocks.querySessionControl.mockImplementation(async (request) => {
      if (request.query.searchText === 'needle') return listResponse([])
      if (request.query.projectPaths) {
        return request.query.cursor
          ? listResponse(remote.slice(100))
          : listResponse(remote.slice(0, 100), { nextCursor: 'alias-page-2' })
      }
      return listResponse([], { totalCount: 0 })
    })
    apiMocks.listSessionsByIds.mockImplementation(async (ids: readonly SessionId[]) =>
      remote.filter((session) => ids.includes(session.id)),
    )

    const { result } = renderHook(() =>
      useRemoteSidebarSessions(
        hookInput({
          query: 'needle',
          projectPaths: paths,
          projectDisplayNames: aliases,
        }),
      ),
    )

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(100)
      expect(result.current.hasMore).toBe(true)
    })
    act(() => result.current.loadMore())
    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(300)
      expect(result.current.hasMore).toBe(false)
    })
    const catalogCalls = apiMocks.querySessionControl.mock.calls.filter(
      ([request]) => request.query.searchText === 'needle',
    )
    const aliasCalls = apiMocks.querySessionControl.mock.calls.filter(
      ([request]) => request.query.projectPaths !== undefined,
    )
    expect(catalogCalls).toHaveLength(1)
    expect(aliasCalls).toHaveLength(2)
    expect(aliasCalls[0]?.[0].query.projectPaths).toHaveLength(1_000)
    expect(aliasCalls[0]?.[0].query.limit).toBe(100)
    expect(aliasCalls[1]?.[0].query.limit).toBe(200)
    expect(aliasCalls[1]?.[0].query.cursor).toBe('alias-page-2')
    expect(catalogCalls.length + aliasCalls.length).toBe(3)
    expect(apiMocks.listSessionsByIds).toHaveBeenCalledTimes(3)
  })
})
