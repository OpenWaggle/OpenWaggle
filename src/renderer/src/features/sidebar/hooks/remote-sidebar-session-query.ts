import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  SESSION_QUERY_DISCOVERY_LIMIT,
} from '@shared/types/session-query'
import { api } from '@/shared/lib/ipc'

export const SIDEBAR_SESSION_HYDRATION_BATCH_SIZE = 100
const QUERY_CONCURRENCY = 8

export type SidebarSearchSource =
  | { readonly kind: 'catalog'; readonly cursor?: string }
  | { readonly kind: 'project'; readonly projectPath: string; readonly cursor?: string }

export async function hydrateSidebarSessions(ids: readonly SessionId[]) {
  const sessions: SessionSummary[] = []
  for (let offset = 0; offset < ids.length; offset += SIDEBAR_SESSION_HYDRATION_BATCH_SIZE) {
    sessions.push(
      ...(await api.listSessionsByIds(
        ids.slice(offset, offset + SIDEBAR_SESSION_HYDRATION_BATCH_SIZE),
      )),
    )
  }
  return sessions
}

async function querySearchSource(source: SidebarSearchSource, query: string) {
  const response = await api.querySessionControl({
    contractVersion: SESSION_QUERY_CONTRACT_VERSION,
    requestId: crypto.randomUUID(),
    query:
      source.kind === 'catalog'
        ? {
            operation: 'list',
            searchText: query,
            archived: false,
            limit: SESSION_QUERY_DISCOVERY_LIMIT,
            ...(source.cursor ? { cursor: source.cursor } : {}),
          }
        : {
            operation: 'list',
            projectPath: source.projectPath,
            archived: false,
            limit: SESSION_QUERY_DISCOVERY_LIMIT,
            ...(source.cursor ? { cursor: source.cursor } : {}),
          },
  })
  if (response.outcome.operation !== 'list' || !('sessions' in response.outcome)) {
    throw new Error('Sidebar Session search returned an unexpected response.')
  }
  return {
    ids: response.outcome.sessions.map((session) => SessionId(session.sessionId)),
    next: response.outcome.nextCursor
      ? ({ ...source, cursor: response.outcome.nextCursor } satisfies SidebarSearchSource)
      : null,
  }
}

export async function querySidebarSearchSources(
  sources: readonly SidebarSearchSource[],
  query: string,
) {
  const pages: Awaited<ReturnType<typeof querySearchSource>>[] = []
  for (let offset = 0; offset < sources.length; offset += QUERY_CONCURRENCY) {
    pages.push(
      ...(await Promise.all(
        sources
          .slice(offset, offset + QUERY_CONCURRENCY)
          .map((source) => querySearchSource(source, query)),
      )),
    )
  }
  return pages
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
