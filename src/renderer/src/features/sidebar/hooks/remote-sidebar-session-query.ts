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
export const SIDEBAR_SEARCH_RESULT_LIMIT = SESSION_QUERY_DISCOVERY_LIMIT

export type SidebarTerminalState = 'completed' | 'error'

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
}) {
  const response = await api.querySessionControl({
    contractVersion: SESSION_QUERY_CONTRACT_VERSION,
    requestId: crypto.randomUUID(),
    query: {
      operation: 'list',
      archived: false,
      limit: SIDEBAR_SEARCH_RESULT_LIMIT,
      ...query,
    },
  })
  if (response.outcome.operation !== 'list' || !('sessions' in response.outcome)) {
    throw new Error('Sidebar Session search returned an unexpected response.')
  }
  return response.outcome.sessions.map((session) => SessionId(session.sessionId))
}

export async function querySidebarSearchSources(
  customAliasProjectPaths: readonly string[],
  query: string,
) {
  const boundedProjectPaths = customAliasProjectPaths.slice(
    0,
    SESSION_QUERY_PROJECT_PATH_FILTER_LIMIT,
  )
  const pages = await Promise.all([
    querySidebarList({ searchText: query }),
    ...(boundedProjectPaths.length > 0
      ? [querySidebarList({ projectPaths: boundedProjectPaths })]
      : []),
  ])
  return [...new Set(pages.flat().map(String))].slice(0, SIDEBAR_SEARCH_RESULT_LIMIT).map(SessionId)
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
