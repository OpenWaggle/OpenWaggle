import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRemoteSidebarSessions } from '../useRemoteSidebarSessions'

const apiMocks = vi.hoisted(() => ({
  listSessionsByIds: vi.fn(),
  querySessionControl: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

function summary(id: string, title: string): SessionSummary {
  return {
    id: SessionId(id),
    title,
    projectPath: '/repo/project',
    createdAt: 1,
    updatedAt: 1,
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('remote sidebar Session filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('finds a title beyond the loaded catalog page through Host discovery', async () => {
    const remote = summary('session-101', 'Needle Session')
    apiMocks.querySessionControl.mockResolvedValue({
      contractVersion: 2,
      requestId: 'search',
      outcome: {
        operation: 'list',
        sessions: [
          {
            sessionId: remote.id,
            title: remote.title,
            projectPath: remote.projectPath,
            archived: false,
            createdAt: 1,
            updatedAt: 1,
            lineageRole: 'independent',
            directWorkerCount: 0,
          },
        ],
      },
    })
    apiMocks.listSessionsByIds.mockResolvedValue([remote])

    const { result } = renderHook(() =>
      useRemoteSidebarSessions({
        query: 'needle',
        filterState: null,
        stateBySessionId: new Map(),
        loadedSessions: Array.from({ length: 100 }, (_, index) =>
          summary(`session-${index}`, `Loaded ${index}`),
        ),
        projectPaths: [],
        projectDisplayNames: {},
      }),
    )

    await waitFor(() => expect(result.current.sessions).toEqual([remote]))
    expect(apiMocks.querySessionControl).toHaveBeenCalledOnce()
    expect(apiMocks.querySessionControl).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ operation: 'list', searchText: 'needle' }),
      }),
    )
    expect(apiMocks.listSessionsByIds).toHaveBeenCalledWith([remote.id])
  })

  it('hydrates a status match that has never been loaded in the sidebar', async () => {
    const remote = summary('session-error-101', 'Remote failure')
    apiMocks.listSessionsByIds.mockResolvedValue([remote])

    const { result } = renderHook(() =>
      useRemoteSidebarSessions({
        query: '',
        filterState: 'error',
        stateBySessionId: new Map([[String(remote.id), 'error']]),
        loadedSessions: [],
        projectPaths: [],
        projectDisplayNames: {},
      }),
    )

    await waitFor(() => expect(result.current.sessions).toEqual([remote]))
    expect(apiMocks.querySessionControl).not.toHaveBeenCalled()
  })

  it('loads interrupted Sessions beyond the first 100 from the Host projection', async () => {
    const remote = Array.from({ length: 129 }, (_, index) =>
      summary(`interrupted-${String(index)}`, `Interrupted ${String(index)}`),
    )
    apiMocks.querySessionControl.mockResolvedValue({
      contractVersion: 2,
      requestId: 'interrupted',
      outcome: {
        operation: 'list',
        totalCount: remote.length,
        sessions: remote.map((session) => ({
          sessionId: session.id,
          title: session.title,
          projectPath: session.projectPath,
          archived: false,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          lineageRole: 'independent',
          directWorkerCount: 0,
        })),
      },
    })
    apiMocks.listSessionsByIds.mockImplementation(async (ids: readonly SessionId[]) =>
      remote.filter((session) => ids.includes(session.id)),
    )

    const { result } = renderHook(() =>
      useRemoteSidebarSessions({
        query: '',
        filterState: 'interrupted',
        stateBySessionId: new Map(),
        loadedSessions: [],
        projectPaths: [],
        projectDisplayNames: {},
      }),
    )

    await waitFor(() => expect(result.current.sessions).toHaveLength(129))
    expect(apiMocks.querySessionControl).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          operation: 'list',
          interrupted: true,
          archived: false,
        }),
      }),
    )
    expect(apiMocks.listSessionsByIds).toHaveBeenCalledTimes(2)
  })

  it('does not reintroduce an archived Session through a retained status', async () => {
    const archived = { ...summary('archived-error', 'Archived failure'), archived: true }
    apiMocks.listSessionsByIds.mockResolvedValue([archived])

    const { result } = renderHook(() =>
      useRemoteSidebarSessions({
        query: '',
        filterState: 'error',
        stateBySessionId: new Map([[String(archived.id), 'error']]),
        loadedSessions: [],
        projectPaths: [],
        projectDisplayNames: {},
      }),
    )

    await waitFor(() => expect(apiMocks.listSessionsByIds).toHaveBeenCalledOnce())
    expect(result.current.sessions).toEqual([])
  })

  it('keeps loaded text matches visible while Host discovery hydrates', () => {
    apiMocks.querySessionControl.mockReturnValue(new Promise(() => undefined))
    const local = summary('loaded-match', 'Plain Session')

    const { result } = renderHook(() =>
      useRemoteSidebarSessions({
        query: 'plain',
        filterState: null,
        stateBySessionId: new Map(),
        loadedSessions: [local],
        projectPaths: [],
        projectDisplayNames: {},
      }),
    )

    expect(result.current.sessions).toEqual([local])
  })

  it('runs at most one load-more query per generation', async () => {
    const secondPage = deferred<{
      contractVersion: number
      requestId: string
      outcome: {
        operation: 'list'
        sessions: readonly []
      }
    }>()
    apiMocks.querySessionControl
      .mockResolvedValueOnce({
        contractVersion: 2,
        requestId: 'first',
        outcome: { operation: 'list', sessions: [], nextCursor: 'next' },
      })
      .mockReturnValueOnce(secondPage.promise)
    apiMocks.listSessionsByIds.mockResolvedValue([])
    const { result } = renderHook(() =>
      useRemoteSidebarSessions({
        query: 'needle',
        filterState: null,
        stateBySessionId: new Map(),
        loadedSessions: [],
        projectPaths: [],
        projectDisplayNames: {},
      }),
    )
    await waitFor(() => expect(result.current.hasMore).toBe(true))

    act(() => {
      result.current.loadMore()
      result.current.loadMore()
    })

    expect(apiMocks.querySessionControl).toHaveBeenCalledTimes(2)
    secondPage.resolve({
      contractVersion: 2,
      requestId: 'second',
      outcome: { operation: 'list', sessions: [] },
    })
    await waitFor(() => expect(result.current.hasMore).toBe(false))
  })
})
