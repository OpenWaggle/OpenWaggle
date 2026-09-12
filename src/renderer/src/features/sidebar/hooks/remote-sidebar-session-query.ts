import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  SESSION_QUERY_DISCOVERY_LIMIT,
  SESSION_QUERY_PROJECT_PATH_FILTER_LIMIT,
} from '@shared/types/session-query'
import { useSessionStatusStore } from '@/features/sessions/state'
import { api } from '@/shared/lib/ipc'

export const SIDEBAR_SESSION_HYDRATION_BATCH_SIZE = 100
export const SIDEBAR_SEARCH_PAGE_LIMIT = SESSION_QUERY_DISCOVERY_LIMIT

interface SidebarSearchSourceCursor {
  readonly cursor?: string
  readonly exhausted: boolean
}

export interface SidebarSearchCursor {
  readonly catalog: SidebarSearchSourceCursor
  readonly alias?: SidebarSearchSourceCursor
}

export type SidebarTerminalState = 'completed' | 'error'
export type SidebarRemoteMode =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'search'
      readonly query: string
      readonly projectPaths: readonly string[]
      readonly cursor?: SidebarSearchCursor
    }
  | { readonly kind: 'status'; readonly ids: readonly SessionId[]; readonly offset: number }
  | { readonly kind: 'interrupted'; readonly cursor?: string }
  | { readonly kind: 'terminal'; readonly state: SidebarTerminalState; readonly cursor?: string }

function terminalRunStatus(state: SidebarTerminalState) {
  return state === 'completed' ? ('completed' as const) : ('failed' as const)
}

export async function hydrateSidebarSessions(ids: readonly SessionId[]) {
  const sessions: SessionSummary[] = []
  for (let offset = 0; offset < ids.length; offset += SIDEBAR_SESSION_HYDRATION_BATCH_SIZE) {
    sessions.push(
      ...(await api.listSessionsByIds(
        ids.slice(offset, offset + SIDEBAR_SESSION_HYDRATION_BATCH_SIZE),
      )),
    )
  }
  useSessionStatusStore.getState().hydratePersistedStatuses(sessions)
  return sessions
}

async function querySidebarList(query: {
  readonly searchText?: string
  readonly projectPaths?: readonly string[]
  readonly cursor?: string
  readonly limit: number
}) {
  const response = await api.querySessionControl({
    contractVersion: SESSION_QUERY_CONTRACT_VERSION,
    requestId: crypto.randomUUID(),
    query: {
      operation: 'list',
      archived: false,
      ...query,
    },
  })
  if (response.outcome.operation !== 'list' || !('sessions' in response.outcome)) {
    throw new Error('Sidebar Session search returned an unexpected response.')
  }
  return {
    ids: response.outcome.sessions.map((session) => SessionId(session.sessionId)),
    nextCursor: response.outcome.nextCursor,
  }
}

function nextSearchSourceCursor(page: { readonly nextCursor?: string }) {
  return {
    exhausted: page.nextCursor === undefined,
    ...(page.nextCursor ? { cursor: page.nextCursor } : {}),
  } satisfies SidebarSearchSourceCursor
}

function initialSearchSourceCursor(current?: SidebarSearchSourceCursor) {
  return current ?? { exhausted: false }
}

function querySearchSource(
  source: SidebarSearchSourceCursor,
  input: { readonly searchText?: string; readonly projectPaths?: readonly string[] },
  limit: number,
) {
  if (source.exhausted) return Promise.resolve(null)
  return querySidebarList({
    ...input,
    limit,
    ...(source.cursor ? { cursor: source.cursor } : {}),
  })
}

function sidebarSearchPageResult(
  ids: readonly SessionId[],
  catalog: SidebarSearchSourceCursor,
  alias?: SidebarSearchSourceCursor,
) {
  if (catalog.exhausted && (alias === undefined || alias.exhausted)) return { ids }
  return {
    ids,
    nextCursor: {
      catalog,
      ...(alias ? { alias } : {}),
    } satisfies SidebarSearchCursor,
  }
}

export async function querySidebarSearchPage(
  customAliasProjectPaths: readonly string[],
  query: string,
  current?: SidebarSearchCursor,
) {
  const boundedProjectPaths = customAliasProjectPaths.slice(
    0,
    SESSION_QUERY_PROJECT_PATH_FILTER_LIMIT,
  )
  const catalog = initialSearchSourceCursor(current?.catalog)
  const alias =
    boundedProjectPaths.length === 0 ? undefined : initialSearchSourceCursor(current?.alias)
  const activeSourceCount =
    Number(!catalog.exhausted) + Number(alias !== undefined && !alias.exhausted)
  const sourceLimit = Math.floor(SIDEBAR_SEARCH_PAGE_LIMIT / Math.max(1, activeSourceCount))
  const [catalogPage, aliasPage] = await Promise.all([
    querySearchSource(catalog, { searchText: query }, sourceLimit),
    alias
      ? querySearchSource(alias, { projectPaths: boundedProjectPaths }, sourceLimit)
      : Promise.resolve(null),
  ])
  const nextCatalog = catalogPage ? nextSearchSourceCursor(catalogPage) : catalog
  const nextAlias = aliasPage ? nextSearchSourceCursor(aliasPage) : alias
  const ids = [...new Set([...(catalogPage?.ids ?? []), ...(aliasPage?.ids ?? [])].map(String))]
    .slice(0, SIDEBAR_SEARCH_PAGE_LIMIT)
    .map(SessionId)
  return sidebarSearchPageResult(ids, nextCatalog, nextAlias)
}

export async function queryTerminalSidebarSessions(
  state: SidebarTerminalState,
  cursor?: string,
  limit = SESSION_QUERY_DISCOVERY_LIMIT,
) {
  const response = await api.querySessionControl({
    contractVersion: SESSION_QUERY_CONTRACT_VERSION,
    requestId: crypto.randomUUID(),
    query: {
      operation: 'list',
      archived: false,
      unreadTerminalStatus: terminalRunStatus(state),
      limit,
      ...(cursor ? { cursor } : {}),
    },
  })
  if (response.outcome.operation !== 'list' || !('sessions' in response.outcome)) {
    throw new Error('Terminal Session filtering returned an unexpected response.')
  }
  return {
    ids: response.outcome.sessions.map((session) => SessionId(session.sessionId)),
    nextCursor: response.outcome.nextCursor,
    totalCount: response.outcome.totalCount,
  }
}

export async function queryTerminalSidebarCounts(refreshKey: string) {
  const [completed, error] = await Promise.all([
    queryTerminalSidebarSessions('completed', undefined, 1),
    queryTerminalSidebarSessions('error', undefined, 1),
  ])
  return {
    refreshKey,
    counts: { completed: completed.totalCount ?? 0, error: error.totalCount ?? 0 },
  }
}

export async function queryInterruptedSidebarSessions(cursor?: string) {
  const response = await api.querySessionControl({
    contractVersion: SESSION_QUERY_CONTRACT_VERSION,
    requestId: crypto.randomUUID(),
    query: {
      operation: 'list',
      archived: false,
      interrupted: true,
      limit: SESSION_QUERY_DISCOVERY_LIMIT,
      ...(cursor ? { cursor } : {}),
    },
  })
  if (response.outcome.operation !== 'list' || !('sessions' in response.outcome)) {
    throw new Error('Interrupted Session filtering returned an unexpected response.')
  }
  return {
    ids: response.outcome.sessions.map((session) => SessionId(session.sessionId)),
    nextCursor: response.outcome.nextCursor,
  }
}
