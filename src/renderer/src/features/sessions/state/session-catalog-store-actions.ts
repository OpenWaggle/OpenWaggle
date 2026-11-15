import { SessionId } from '@shared/types/brand'
import { SESSION_CATALOG_PAGE_SIZE } from '@shared/types/openwaggle-api-session-catalog'
import type { SessionSummary } from '@shared/types/session'
import { loadInBatches } from '@shared/utils/batches'
import { coalescedRead } from '@/shared/lib/coalesced-read'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { readPinnedSessions } from '@/shared/lib/pinned-sessions-read'

const logger = createRendererLogger('session-catalog-store')
let latestCatalogRequestId = 0
let latestHiveRequestId = 0
let catalogOperationId = 0
const targetedSessionOperationIds = new Map<string, number>()
const activeCatalogReadOperationIds = new Set<number>()
const activeTargetedOperationIds = new Set<number>()

function pruneTargetedSessionOperationIds() {
  for (const [sessionId, operationId] of targetedSessionOperationIds) {
    if (activeTargetedOperationIds.has(operationId)) continue
    const protectsActiveRead = [...activeCatalogReadOperationIds].some(
      (readOperationId) => readOperationId < operationId,
    )
    if (!protectsActiveRead) targetedSessionOperationIds.delete(sessionId)
  }
}

export interface SessionCatalogState {
  sessions: readonly SessionSummary[]
  archivedSessions: readonly SessionSummary[]
  hiveSessions: readonly SessionSummary[]
  hiveContextSessionId: SessionId | null
  sessionsNextCursor: string | null
  hiveWorkersNextCursor: string | null
  sessionsLoadingMore: boolean
  loadSessions: () => Promise<void>
  loadMoreSessions: () => Promise<void>
  refreshCatalogSessions: (sessionIds: readonly SessionId[]) => Promise<void>
  loadHiveSessions: (sessionId: SessionId) => Promise<void>
  loadMoreHiveSessions: (sessionId: SessionId) => Promise<void>
}

type CatalogSet = (
  partial:
    | Partial<SessionCatalogState>
    | ((state: SessionCatalogState) => Partial<SessionCatalogState>),
) => void
type CatalogGet = () => SessionCatalogState

function appendUnique(current: readonly SessionSummary[], incoming: readonly SessionSummary[]) {
  const byId = new Map(current.map((session) => [session.id, session]))
  for (const session of incoming) byId.set(session.id, session)
  return [...byId.values()]
}

async function loadPinnedSessionSummaries() {
  const pins = await readPinnedSessions()
  const sessions: SessionSummary[] = []
  for (let offset = 0; offset < pins.length; offset += SESSION_CATALOG_PAGE_SIZE) {
    const ids = pins.slice(offset, offset + SESSION_CATALOG_PAGE_SIZE).map((pin) => pin.sessionId)
    sessions.push(...(await api.listSessionsByIds(ids)))
  }
  return sessions
}

async function loadCatalog(set: CatalogSet) {
  catalogOperationId += 1
  const requestId = catalogOperationId
  latestCatalogRequestId = requestId
  activeCatalogReadOperationIds.add(requestId)
  try {
    const [active, archived, pinned] = await Promise.all([
      api.listSessionCatalogPage(false, SESSION_CATALOG_PAGE_SIZE),
      api.listSessionCatalogPage(true, SESSION_CATALOG_PAGE_SIZE),
      loadPinnedSessionSummaries().catch((error: unknown) => {
        logger.warn('Failed to hydrate pinned Sessions', { error: String(error) })
        return []
      }),
    ])
    if (requestId !== latestCatalogRequestId) return
    set((state) => {
      const protectedIds = new Set(
        [...targetedSessionOperationIds.entries()]
          .filter(([, operationId]) => operationId > requestId)
          .map(([sessionId]) => sessionId),
      )
      const freshActive = appendUnique(
        active.sessions,
        pinned.filter((session) => !session.archived),
      ).filter((session) => !protectedIds.has(String(session.id)))
      const freshArchived = appendUnique(
        archived.sessions,
        pinned.filter((session) => session.archived === true),
      ).filter((session) => !protectedIds.has(String(session.id)))
      return {
        sessions: appendUnique(
          freshActive,
          state.sessions.filter((session) => protectedIds.has(String(session.id))),
        ),
        archivedSessions: appendUnique(
          freshArchived,
          state.archivedSessions.filter((session) => protectedIds.has(String(session.id))),
        ),
        sessionsNextCursor: active.nextCursor ?? null,
        sessionsLoadingMore: false,
      }
    })
  } catch (error) {
    if (requestId !== latestCatalogRequestId) return
    set({ sessionsLoadingMore: false })
    logger.error('Failed to load Session catalog', { error: String(error) })
  } finally {
    activeCatalogReadOperationIds.delete(requestId)
    pruneTargetedSessionOperationIds()
  }
}

async function refreshCatalogSessions(
  set: CatalogSet,
  get: CatalogGet,
  sessionIds: readonly SessionId[],
) {
  const requestedIds = [...new Set(sessionIds.map(String))].map(SessionId)
  if (requestedIds.length === 0) return
  catalogOperationId += 1
  const operationId = catalogOperationId
  activeTargetedOperationIds.add(operationId)
  for (const sessionId of requestedIds) {
    targetedSessionOperationIds.set(String(sessionId), operationId)
  }
  try {
    const refreshed = await loadInBatches(requestedIds, SESSION_CATALOG_PAGE_SIZE, (ids) =>
      api.listSessionsByIds(ids),
    )
    const requested = new Set(
      requestedIds
        .filter((sessionId) => targetedSessionOperationIds.get(String(sessionId)) === operationId)
        .map(String),
    )
    if (requested.size === 0) return
    const currentRefreshed = refreshed.filter((session) => requested.has(String(session.id)))
    set((state) => ({
      sessions: appendUnique(
        state.sessions.filter((session) => !requested.has(String(session.id))),
        currentRefreshed.filter((session) => session.archived !== true),
      ),
      archivedSessions: appendUnique(
        state.archivedSessions.filter((session) => !requested.has(String(session.id))),
        currentRefreshed.filter((session) => session.archived === true),
      ),
    }))
    const hiveContextSessionId = get().hiveContextSessionId
    const missingRequestedSession = [...requested].some(
      (sessionId) => !currentRefreshed.some((session) => String(session.id) === sessionId),
    )
    if (
      hiveContextSessionId &&
      (missingRequestedSession ||
        currentRefreshed.some(
          (session) =>
            session.id === hiveContextSessionId ||
            session.lineage?.parentSessionId === hiveContextSessionId,
        ))
    ) {
      await get().loadHiveSessions(hiveContextSessionId)
    }
  } catch (error) {
    // The Session Host refresh fires this action with `void`, so a rejection here would float as
    // an unhandled renderer rejection (Sentry issues OPENWAGGLE-6 and OPENWAGGLE-7). A targeted
    // refresh is best effort: the next host event retries it, so the failure is only logged.
    logger.warn('Failed to refresh Sessions in the catalog', { error: String(error) })
  } finally {
    activeTargetedOperationIds.delete(operationId)
    pruneTargetedSessionOperationIds()
  }
}

export function createSessionCatalogState(set: CatalogSet, get: CatalogGet) {
  // The chat and sidebar stores both load the catalog at startup; one load serves both.
  const loadSessions = coalescedRead(() => loadCatalog(set))
  const result: SessionCatalogState = {
    sessions: [],
    archivedSessions: [],
    hiveSessions: [],
    hiveContextSessionId: null,
    sessionsNextCursor: null,
    hiveWorkersNextCursor: null,
    sessionsLoadingMore: false,
    loadSessions,
    async loadMoreSessions() {
      const cursor = get().sessionsNextCursor
      if (!cursor || get().sessionsLoadingMore) return
      set({ sessionsLoadingMore: true })
      catalogOperationId += 1
      const operationId = catalogOperationId
      activeCatalogReadOperationIds.add(operationId)
      try {
        const page = await api.listSessionCatalogPage(false, SESSION_CATALOG_PAGE_SIZE, cursor)
        if (get().sessionsNextCursor !== cursor) {
          set({ sessionsLoadingMore: false })
          return
        }
        const currentPage = page.sessions.filter(
          (session) => (targetedSessionOperationIds.get(String(session.id)) ?? 0) <= operationId,
        )
        set((state) => ({
          sessions: appendUnique(state.sessions, currentPage),
          sessionsNextCursor: page.nextCursor ?? null,
          sessionsLoadingMore: false,
        }))
      } catch (error) {
        set({ sessionsLoadingMore: false })
        logger.error('Failed to load more Sessions', { error: String(error) })
      } finally {
        activeCatalogReadOperationIds.delete(operationId)
        pruneTargetedSessionOperationIds()
      }
    },
    refreshCatalogSessions: (sessionIds) => refreshCatalogSessions(set, get, sessionIds),
    async loadHiveSessions(sessionId) {
      latestHiveRequestId += 1
      const requestId = latestHiveRequestId
      try {
        const page = await api.listHiveSessionCatalogPage(sessionId, SESSION_CATALOG_PAGE_SIZE)
        if (requestId !== latestHiveRequestId) return
        set({
          hiveSessions: appendUnique(page.context, page.workers),
          hiveContextSessionId: sessionId,
          hiveWorkersNextCursor: page.nextCursor ?? null,
        })
      } catch (error) {
        if (requestId === latestHiveRequestId) {
          logger.error('Failed to load Hive Sessions', { error: String(error) })
        }
      }
    },
    async loadMoreHiveSessions(sessionId) {
      const cursor = get().hiveWorkersNextCursor
      if (!cursor) return
      try {
        const page = await api.listHiveSessionCatalogPage(
          sessionId,
          SESSION_CATALOG_PAGE_SIZE,
          cursor,
        )
        if (get().hiveWorkersNextCursor !== cursor) return
        set((state) => ({
          hiveSessions: appendUnique(state.hiveSessions, [...page.context, ...page.workers]),
          hiveWorkersNextCursor: page.nextCursor ?? null,
        }))
      } catch (error) {
        logger.error('Failed to load more Hive Sessions', { error: String(error) })
      }
    },
  }
  return result
}
