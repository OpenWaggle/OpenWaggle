import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  SESSION_QUERY_DISCOVERY_LIMIT,
} from '@shared/types/session-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import type { SidebarRowState } from '../lib/sidebar-row-state'

const HYDRATION_BATCH_SIZE = 100
const QUERY_CONCURRENCY = 8

type SearchSource =
  | { readonly kind: 'lexical'; readonly cursor?: string }
  | { readonly kind: 'project'; readonly projectPath: string; readonly cursor?: string }

type RemoteMode =
  | { readonly kind: 'none' }
  | { readonly kind: 'status'; readonly ids: readonly SessionId[]; readonly offset: number }
  | { readonly kind: 'search'; readonly query: string; readonly sources: readonly SearchSource[] }

function appendUnique(current: readonly SessionSummary[], incoming: readonly SessionSummary[]) {
  const byId = new Map(current.map((session) => [String(session.id), session]))
  for (const session of incoming) byId.set(String(session.id), session)
  return [...byId.values()]
}

async function hydrateSessionIds(ids: readonly SessionId[]) {
  const sessions: SessionSummary[] = []
  for (let offset = 0; offset < ids.length; offset += HYDRATION_BATCH_SIZE) {
    sessions.push(
      ...(await api.listSessionsByIds(ids.slice(offset, offset + HYDRATION_BATCH_SIZE))),
    )
  }
  return sessions
}

async function querySource(source: SearchSource, query: string) {
  const response = await api.querySessionControl({
    contractVersion: SESSION_QUERY_CONTRACT_VERSION,
    requestId: crypto.randomUUID(),
    query:
      source.kind === 'lexical'
        ? {
            operation: 'search',
            query,
            mode: 'lexical',
            includeArchived: false,
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
  if (
    response.outcome.operation !== (source.kind === 'lexical' ? 'search' : 'list') ||
    !('sessions' in response.outcome)
  ) {
    throw new Error('Sidebar Session search returned an unexpected response.')
  }
  return {
    ids: response.outcome.sessions.map((session) => SessionId(session.sessionId)),
    next: response.outcome.nextCursor
      ? ({ ...source, cursor: response.outcome.nextCursor } satisfies SearchSource)
      : null,
  }
}

async function querySources(sources: readonly SearchSource[], query: string) {
  const pages: Awaited<ReturnType<typeof querySource>>[] = []
  for (let offset = 0; offset < sources.length; offset += QUERY_CONCURRENCY) {
    pages.push(
      ...(await Promise.all(
        sources
          .slice(offset, offset + QUERY_CONCURRENCY)
          .map((source) => querySource(source, query)),
      )),
    )
  }
  return pages
}

function sessionMatchesText(
  session: SessionSummary,
  query: string,
  projectDisplayNames: Readonly<Record<string, string>>,
) {
  if (query === '') return true
  const projectPath = session.projectPath ?? ''
  const projectName = projectPath.split('/').filter(Boolean).at(-1) ?? ''
  const customName = projectDisplayNames[projectPath] ?? ''
  return [session.title, projectName, customName].some((value) =>
    value.toLowerCase().includes(query),
  )
}

export function useRemoteSidebarSessions(input: {
  readonly query: string
  readonly filterState: SidebarRowState | null
  readonly stateBySessionId: ReadonlyMap<string, SidebarRowState>
  readonly loadedSessions: readonly SessionSummary[]
  readonly projectPaths: readonly string[]
  readonly projectDisplayNames: Readonly<Record<string, string>>
}) {
  const normalizedQuery = input.query.trim().toLowerCase()
  const matchingProjectPaths = [...new Set(input.projectPaths)].filter((projectPath) => {
    const name = projectPath.split('/').filter(Boolean).at(-1) ?? ''
    const custom = input.projectDisplayNames[projectPath] ?? ''
    return [name, custom].some((value) => value.toLowerCase().includes(normalizedQuery))
  })
  const matchingProjectPathsKey = matchingProjectPaths.join('\u0000')
  const statusIds =
    input.filterState === null
      ? []
      : [...input.stateBySessionId.entries()]
          .filter(([, state]) => state === input.filterState)
          .map(([sessionId]) => SessionId(sessionId))
          .sort()
  const statusIdsKey = statusIds.join('\u0000')
  const stableMatchingProjectPaths = useRef({ key: '', values: matchingProjectPaths })
  if (stableMatchingProjectPaths.current.key !== matchingProjectPathsKey) {
    stableMatchingProjectPaths.current = {
      key: matchingProjectPathsKey,
      values: matchingProjectPaths,
    }
  }
  const stableStatusIds = useRef({ key: '', values: statusIds })
  if (stableStatusIds.current.key !== statusIdsKey) {
    stableStatusIds.current = { key: statusIdsKey, values: statusIds }
  }
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([])
  const [hasMore, setHasMore] = useState(false)
  const mode = useRef<RemoteMode>({ kind: 'none' })
  const generation = useRef(0)
  const projectDisplayNames = useRef(input.projectDisplayNames)
  projectDisplayNames.current = input.projectDisplayNames
  const requestKey = `${input.filterState ?? ''}\u0001${normalizedQuery}\u0001${statusIdsKey}\u0001${matchingProjectPathsKey}`
  const activeRequestKey = useRef('')

  const settleFailure = useCallback((requestGeneration: number) => {
    if (generation.current !== requestGeneration) return
    mode.current = { kind: 'none' }
    setHasMore(false)
  }, [])

  const publishStatusPage = useCallback(
    async (ids: readonly SessionId[], offset: number, requestGeneration: number) => {
      const pageIds = ids.slice(offset, offset + HYDRATION_BATCH_SIZE)
      const hydrated = await hydrateSessionIds(pageIds)
      if (generation.current !== requestGeneration) return
      setSessions((current) =>
        appendUnique(current, hydrated).filter((session) =>
          sessionMatchesText(session, normalizedQuery, projectDisplayNames.current),
        ),
      )
      const nextOffset = offset + pageIds.length
      mode.current = { kind: 'status', ids, offset: nextOffset }
      setHasMore(nextOffset < ids.length)
    },
    [normalizedQuery],
  )

  const publishSearchPage = useCallback(
    async (query: string, sources: readonly SearchSource[], requestGeneration: number) => {
      const pages = await querySources(sources, query)
      const hydrated = await hydrateSessionIds(
        [...new Set(pages.flatMap((page) => page.ids).map(String))].map(SessionId),
      )
      if (generation.current !== requestGeneration) return
      setSessions((current) => appendUnique(current, hydrated))
      const nextSources = pages.flatMap((page) => (page.next ? [page.next] : []))
      mode.current = { kind: 'search', query, sources: nextSources }
      setHasMore(nextSources.length > 0)
    },
    [],
  )

  useEffect(() => {
    activeRequestKey.current = requestKey
    generation.current += 1
    const requestGeneration = generation.current
    setSessions([])
    setHasMore(false)
    if (input.filterState !== null) {
      mode.current = { kind: 'status', ids: stableStatusIds.current.values, offset: 0 }
      void publishStatusPage(stableStatusIds.current.values, 0, requestGeneration).catch(() =>
        settleFailure(requestGeneration),
      )
      return
    }
    if (normalizedQuery !== '') {
      const sources: SearchSource[] = [
        { kind: 'lexical' },
        ...stableMatchingProjectPaths.current.values.map((projectPath) => ({
          kind: 'project' as const,
          projectPath,
        })),
      ]
      mode.current = { kind: 'search', query: normalizedQuery, sources }
      void publishSearchPage(normalizedQuery, sources, requestGeneration).catch(() =>
        settleFailure(requestGeneration),
      )
      return
    }
    mode.current = { kind: 'none' }
  }, [
    input.filterState,
    normalizedQuery,
    publishSearchPage,
    publishStatusPage,
    settleFailure,
    requestKey,
  ])

  const loadMore = useCallback(() => {
    const current = mode.current
    if (current.kind === 'none') return
    const requestGeneration = generation.current
    if (current.kind === 'status') {
      void publishStatusPage(current.ids, current.offset, requestGeneration).catch(() =>
        settleFailure(requestGeneration),
      )
      return
    }
    if (current.sources.length > 0) {
      void publishSearchPage(current.query, current.sources, requestGeneration).catch(() =>
        settleFailure(requestGeneration),
      )
    }
  }, [publishSearchPage, publishStatusPage, settleFailure])

  const loadedStatusMatches =
    input.filterState === null
      ? []
      : input.loadedSessions.filter(
          (session) =>
            input.stateBySessionId.get(String(session.id)) === input.filterState &&
            sessionMatchesText(session, normalizedQuery, input.projectDisplayNames),
        )

  return {
    active: input.filterState !== null || normalizedQuery !== '',
    sessions: input.filterState === null ? sessions : appendUnique(loadedStatusMatches, sessions),
    hasMore,
    loadMore,
  }
}
