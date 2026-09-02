import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '../session-store'

const apiMocks = vi.hoisted(() => ({
  listHiveSessionCatalogPage: vi.fn(),
  listPinnedSessions: vi.fn(),
  listSessionCatalogPage: vi.fn(),
  listSessionsByIds: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

function summary(id: string, title = id): SessionSummary {
  return { id: SessionId(id), title, projectPath: null, createdAt: 1, updatedAt: 2 }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function resetStore() {
  useSessionStore.setState({
    ...useSessionStore.getInitialState(),
    sessions: [],
    archivedSessions: [],
    hiveSessions: [],
    hiveContextSessionId: null,
    sessionsNextCursor: null,
    archivedSessionsNextCursor: null,
    hiveWorkersNextCursor: null,
    sessionsLoadingMore: false,
    archivedSessionsLoadingMore: false,
  })
}

describe('Session catalog targeted refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.listPinnedSessions.mockResolvedValue([])
    apiMocks.listSessionsByIds.mockResolvedValue([])
    apiMocks.listHiveSessionCatalogPage.mockResolvedValue({ context: [], workers: [] })
    resetStore()
  })

  it('preserves already loaded pages while refreshing changed Sessions', async () => {
    apiMocks.listSessionCatalogPage.mockImplementation(
      async (archived: boolean, _limit: number, cursor?: string) => {
        if (archived) return { sessions: [] }
        return cursor
          ? { sessions: [summary('older')] }
          : { sessions: [summary('newest')], nextCursor: 'next' }
      },
    )
    await useSessionStore.getState().loadSessions()
    await useSessionStore.getState().loadMoreSessions()
    apiMocks.listSessionsByIds.mockResolvedValue([summary('newest', 'Updated title')])

    await useSessionStore.getState().refreshCatalogSessions([SessionId('newest')])

    expect(useSessionStore.getState().sessions.map((session) => session.id)).toEqual([
      'older',
      'newest',
    ])
    expect(useSessionStore.getState().sessions.at(-1)?.title).toBe('Updated title')
  })

  it('releases load-more state when a refresh replaces its cursor', async () => {
    let resolveStalePage: (value: { sessions: readonly SessionSummary[] }) => void = () => undefined
    const stalePage = new Promise<{ sessions: readonly SessionSummary[] }>((resolve) => {
      resolveStalePage = resolve
    })
    apiMocks.listSessionCatalogPage.mockImplementation(
      async (archived: boolean, _limit: number, cursor?: string) => {
        if (archived) return { sessions: [] }
        if (cursor === 'stale') return stalePage
        return { sessions: [summary('first')], nextCursor: 'stale' }
      },
    )
    await useSessionStore.getState().loadSessions()
    const staleLoad = useSessionStore.getState().loadMoreSessions()
    apiMocks.listSessionCatalogPage.mockImplementation(
      async (archived: boolean, _limit: number, cursor?: string) => {
        if (archived) return { sessions: [] }
        return cursor === 'replacement'
          ? { sessions: [summary('replacement-page')] }
          : { sessions: [summary('refreshed')], nextCursor: 'replacement' }
      },
    )
    await useSessionStore.getState().loadSessions()
    resolveStalePage({ sessions: [summary('stale-page')] })
    await staleLoad

    expect(useSessionStore.getState().sessionsLoadingMore).toBe(false)
    await useSessionStore.getState().loadMoreSessions()
    expect(useSessionStore.getState().sessions.map((session) => session.id)).toEqual([
      'refreshed',
      'replacement-page',
    ])
  })

  it('refreshes the focused Hive when an external Worker arrives', async () => {
    const independent = {
      ...summary('queen'),
      lineage: { role: 'independent' as const, directWorkerCount: 0, activeDirectWorkerCount: 0 },
    }
    const queen = {
      ...summary('queen'),
      lineage: { role: 'queen' as const, directWorkerCount: 1, activeDirectWorkerCount: 1 },
    }
    const worker = {
      ...summary('worker'),
      lineage: {
        role: 'worker' as const,
        parentSessionId: SessionId('queen'),
        hiveRootSessionId: SessionId('queen'),
        directWorkerCount: 0,
        activeDirectWorkerCount: 0,
      },
    }
    apiMocks.listHiveSessionCatalogPage
      .mockResolvedValueOnce({ context: [independent], workers: [] })
      .mockResolvedValueOnce({ context: [queen], workers: [worker] })
    apiMocks.listSessionsByIds.mockResolvedValue([worker])
    await useSessionStore.getState().loadHiveSessions(SessionId('queen'))

    await useSessionStore.getState().refreshCatalogSessions([SessionId('worker')])

    expect(apiMocks.listHiveSessionCatalogPage).toHaveBeenCalledTimes(2)
    expect(useSessionStore.getState().hiveSessions).toEqual([queen, worker])
  })

  it('preserves a targeted refresh that completes before an older full catalog load', async () => {
    const staleActive = deferred<{ sessions: readonly SessionSummary[]; nextCursor?: string }>()
    apiMocks.listSessionCatalogPage.mockImplementation(async (archived: boolean) => {
      if (archived) return { sessions: [] }
      return staleActive.promise
    })
    useSessionStore.setState({ sessions: [summary('raced', 'Original')] })

    const fullLoad = useSessionStore.getState().loadSessions()
    apiMocks.listSessionsByIds.mockResolvedValue([summary('raced', 'Fresh event title')])
    await useSessionStore.getState().refreshCatalogSessions([SessionId('raced')])
    staleActive.resolve({ sessions: [summary('raced', 'Stale full-load title')] })
    await fullLoad

    expect(useSessionStore.getState().sessions).toEqual([summary('raced', 'Fresh event title')])
  })

  it('discards an older targeted response for the same Session', async () => {
    const older = deferred<readonly SessionSummary[]>()
    apiMocks.listSessionsByIds
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce([summary('raced-target', 'Newest title')])

    const olderRefresh = useSessionStore
      .getState()
      .refreshCatalogSessions([SessionId('raced-target')])
    await useSessionStore.getState().refreshCatalogSessions([SessionId('raced-target')])
    older.resolve([summary('raced-target', 'Older title')])
    await olderRefresh

    expect(useSessionStore.getState().sessions).toEqual([summary('raced-target', 'Newest title')])
  })
})
