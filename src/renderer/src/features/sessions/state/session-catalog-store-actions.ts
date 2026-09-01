import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('session-catalog-store')
const PAGE_SIZE = 100
let latestCatalogRequestId = 0
let latestHiveRequestId = 0

export interface SessionCatalogState {
  sessions: readonly SessionSummary[]
  archivedSessions: readonly SessionSummary[]
  hiveSessions: readonly SessionSummary[]
  hiveContextSessionId: SessionId | null
  sessionsNextCursor: string | null
  archivedSessionsNextCursor: string | null
  hiveWorkersNextCursor: string | null
  sessionsLoadingMore: boolean
  loadSessions: () => Promise<void>
  loadMoreSessions: () => Promise<void>
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
  const pins = await api.listPinnedSessions()
  const sessions: SessionSummary[] = []
  for (let offset = 0; offset < pins.length; offset += PAGE_SIZE) {
    const ids = pins.slice(offset, offset + PAGE_SIZE).map((pin) => pin.sessionId)
    sessions.push(...(await api.listSessionsByIds(ids)))
  }
  return sessions
}

async function loadCatalog(set: CatalogSet) {
  latestCatalogRequestId += 1
  const requestId = latestCatalogRequestId
  try {
    const [active, archived, pinned] = await Promise.all([
      api.listSessionCatalogPage(false, PAGE_SIZE),
      api.listSessionCatalogPage(true, PAGE_SIZE),
      loadPinnedSessionSummaries().catch((error: unknown) => {
        logger.warn('Failed to hydrate pinned Sessions', { error: String(error) })
        return []
      }),
    ])
    if (requestId !== latestCatalogRequestId) return
    set({
      sessions: appendUnique(
        active.sessions,
        pinned.filter((session) => !session.archived),
      ),
      archivedSessions: appendUnique(
        archived.sessions,
        pinned.filter((session) => session.archived === true),
      ),
      sessionsNextCursor: active.nextCursor ?? null,
      archivedSessionsNextCursor: archived.nextCursor ?? null,
      sessionsLoadingMore: false,
    })
  } catch (error) {
    if (requestId !== latestCatalogRequestId) return
    set({ sessionsLoadingMore: false })
    logger.error('Failed to load Session catalog', { error: String(error) })
  }
}

export function createSessionCatalogState(set: CatalogSet, get: CatalogGet): SessionCatalogState {
  return {
    sessions: [],
    archivedSessions: [],
    hiveSessions: [],
    hiveContextSessionId: null,
    sessionsNextCursor: null,
    archivedSessionsNextCursor: null,
    hiveWorkersNextCursor: null,
    sessionsLoadingMore: false,
    loadSessions: () => loadCatalog(set),
    async loadMoreSessions() {
      const cursor = get().sessionsNextCursor
      if (!cursor || get().sessionsLoadingMore) return
      set({ sessionsLoadingMore: true })
      try {
        const page = await api.listSessionCatalogPage(false, PAGE_SIZE, cursor)
        if (get().sessionsNextCursor !== cursor) return
        set((state) => ({
          sessions: appendUnique(state.sessions, page.sessions),
          sessionsNextCursor: page.nextCursor ?? null,
          sessionsLoadingMore: false,
        }))
      } catch (error) {
        set({ sessionsLoadingMore: false })
        logger.error('Failed to load more Sessions', { error: String(error) })
      }
    },
    async loadHiveSessions(sessionId) {
      latestHiveRequestId += 1
      const requestId = latestHiveRequestId
      try {
        const page = await api.listHiveSessionCatalogPage(sessionId, PAGE_SIZE)
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
        const page = await api.listHiveSessionCatalogPage(sessionId, PAGE_SIZE, cursor)
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
}
