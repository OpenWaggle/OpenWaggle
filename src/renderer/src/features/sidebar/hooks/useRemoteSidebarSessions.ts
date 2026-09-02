import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SidebarRowState } from '../lib/sidebar-row-state'
import {
  hydrateSidebarSessions,
  queryInterruptedSidebarSessions,
  querySidebarSearchSources,
  SIDEBAR_SESSION_HYDRATION_BATCH_SIZE,
  type SidebarSearchSource,
} from './remote-sidebar-session-query'

type RemoteMode =
  | { readonly kind: 'none' }
  | { readonly kind: 'status'; readonly ids: readonly SessionId[]; readonly offset: number }
  | { readonly kind: 'interrupted'; readonly cursor?: string }
  | {
      readonly kind: 'search'
      readonly query: string
      readonly sources: readonly SidebarSearchSource[]
    }

function appendUnique(current: readonly SessionSummary[], incoming: readonly SessionSummary[]) {
  const byId = new Map(current.map((session) => [String(session.id), session]))
  for (const session of incoming) byId.set(String(session.id), session)
  return [...byId.values()]
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
    input.filterState === null || input.filterState === 'interrupted'
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
  const inFlightGeneration = useRef<number | null>(null)
  const projectDisplayNames = useRef(input.projectDisplayNames)
  projectDisplayNames.current = input.projectDisplayNames
  const requestKey = `${input.filterState ?? ''}\u0001${normalizedQuery}\u0001${statusIdsKey}\u0001${matchingProjectPathsKey}`
  const activeRequestKey = useRef('')

  const settleFailure = useCallback((requestGeneration: number) => {
    if (generation.current !== requestGeneration) return
    mode.current = { kind: 'none' }
    setHasMore(false)
  }, [])

  const runPage = useCallback(
    (requestGeneration: number, request: () => Promise<void>) => {
      if (inFlightGeneration.current === requestGeneration) return
      inFlightGeneration.current = requestGeneration
      void request()
        .catch(() => settleFailure(requestGeneration))
        .finally(() => {
          if (inFlightGeneration.current === requestGeneration) {
            inFlightGeneration.current = null
          }
        })
    },
    [settleFailure],
  )

  const publishStatusPage = useCallback(
    async (ids: readonly SessionId[], offset: number, requestGeneration: number) => {
      const pageIds = ids.slice(offset, offset + SIDEBAR_SESSION_HYDRATION_BATCH_SIZE)
      const hydrated = (await hydrateSidebarSessions(pageIds)).filter(
        (session) => session.archived !== true,
      )
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
    async (query: string, sources: readonly SidebarSearchSource[], requestGeneration: number) => {
      const pages = await querySidebarSearchSources(sources, query)
      const hydrated = (
        await hydrateSidebarSessions(
          [...new Set(pages.flatMap((page) => page.ids).map(String))].map(SessionId),
        )
      ).filter((session) => session.archived !== true)
      if (generation.current !== requestGeneration) return
      setSessions((current) => appendUnique(current, hydrated))
      const nextSources = pages.flatMap((page) => (page.next ? [page.next] : []))
      mode.current = { kind: 'search', query, sources: nextSources }
      setHasMore(nextSources.length > 0)
    },
    [],
  )

  const publishInterruptedPage = useCallback(
    async (cursor: string | undefined, requestGeneration: number) => {
      const page = await queryInterruptedSidebarSessions(cursor)
      const hydrated = await hydrateSidebarSessions(page.ids)
      if (generation.current !== requestGeneration) return
      setSessions((current) => appendUnique(current, hydrated))
      mode.current = page.nextCursor
        ? { kind: 'interrupted', cursor: page.nextCursor }
        : { kind: 'none' }
      setHasMore(page.nextCursor !== undefined)
    },
    [],
  )

  useEffect(() => {
    activeRequestKey.current = requestKey
    generation.current += 1
    const requestGeneration = generation.current
    setSessions([])
    setHasMore(false)
    if (input.filterState === 'interrupted') {
      mode.current = { kind: 'interrupted' }
      runPage(requestGeneration, () => publishInterruptedPage(undefined, requestGeneration))
      return
    }
    if (input.filterState !== null) {
      mode.current = { kind: 'status', ids: stableStatusIds.current.values, offset: 0 }
      runPage(requestGeneration, () =>
        publishStatusPage(stableStatusIds.current.values, 0, requestGeneration),
      )
      return
    }
    if (normalizedQuery !== '') {
      const sources: SidebarSearchSource[] = [
        { kind: 'catalog' },
        ...stableMatchingProjectPaths.current.values.map((projectPath) => ({
          kind: 'project' as const,
          projectPath,
        })),
      ]
      mode.current = { kind: 'search', query: normalizedQuery, sources }
      runPage(requestGeneration, () =>
        publishSearchPage(normalizedQuery, sources, requestGeneration),
      )
      return
    }
    mode.current = { kind: 'none' }
  }, [
    input.filterState,
    normalizedQuery,
    publishSearchPage,
    publishInterruptedPage,
    publishStatusPage,
    requestKey,
    runPage,
  ])

  const loadMore = useCallback(() => {
    const current = mode.current
    if (current.kind === 'none') return
    const requestGeneration = generation.current
    if (current.kind === 'status') {
      runPage(requestGeneration, () =>
        publishStatusPage(current.ids, current.offset, requestGeneration),
      )
      return
    }
    if (current.kind === 'interrupted') {
      runPage(requestGeneration, () => publishInterruptedPage(current.cursor, requestGeneration))
      return
    }
    if (current.sources.length > 0) {
      runPage(requestGeneration, () =>
        publishSearchPage(current.query, current.sources, requestGeneration),
      )
    }
  }, [publishInterruptedPage, publishSearchPage, publishStatusPage, runPage])

  const visibleSessions = useMemo(() => {
    const loadedMatches = input.loadedSessions.filter((session) => {
      if (
        input.filterState !== null &&
        input.stateBySessionId.get(String(session.id)) !== input.filterState
      ) {
        return false
      }
      return sessionMatchesText(session, normalizedQuery, input.projectDisplayNames)
    })
    return appendUnique(loadedMatches, sessions)
  }, [
    input.filterState,
    input.loadedSessions,
    input.projectDisplayNames,
    input.stateBySessionId,
    normalizedQuery,
    sessions,
  ])

  return {
    active: input.filterState !== null || normalizedQuery !== '',
    sessions: visibleSessions,
    hasMore,
    loadMore,
  }
}
