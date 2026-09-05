import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SidebarRowState } from '../lib/sidebar-row-state'
import {
  hydrateSidebarSessions,
  queryInterruptedSidebarSessions,
  querySidebarSearchPage,
  queryTerminalSidebarCounts,
  queryTerminalSidebarSessions,
  SIDEBAR_SESSION_HYDRATION_BATCH_SIZE,
  type SidebarRemoteMode,
  type SidebarSearchCursor,
  type SidebarTerminalState,
} from './remote-sidebar-session-query'
import {
  appendUniqueSidebarSessions,
  mergeVisibleSidebarSessions,
  sidebarSessionMatchesText,
} from './remote-sidebar-session-results'

export interface ExactTerminalCounts {
  readonly completed?: number
  readonly error?: number
}

const REMOTE_SIDEBAR_SEARCH_MINIMUM_LENGTH = 3
const REMOTE_SIDEBAR_SEARCH_DEBOUNCE_MS = 150

function isTerminalState(state: SidebarRowState | null): state is SidebarTerminalState {
  return state === 'completed' || state === 'error'
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
    const custom = input.projectDisplayNames[projectPath] ?? ''
    return custom.toLowerCase().includes(normalizedQuery)
  })
  const matchingProjectPathsKey = matchingProjectPaths.join('\u0000')
  const stableMatchingProjectPaths = useMemo(
    () => (matchingProjectPathsKey === '' ? [] : matchingProjectPathsKey.split('\u0000')),
    [matchingProjectPathsKey],
  )
  const statusIds =
    input.filterState === null || input.filterState === 'interrupted'
      ? []
      : [...input.stateBySessionId.entries()]
          .filter(([, state]) => state === input.filterState)
          .map(([sessionId]) => SessionId(sessionId))
          .sort()
  const statusIdsKey = statusIds.join('\u0000')
  const stableStatusIds = useMemo(
    () => (statusIdsKey === '' ? [] : statusIdsKey.split('\u0000').map(SessionId)),
    [statusIdsKey],
  )
  const terminalStateKey = [...input.stateBySessionId.entries()]
    .filter(([, state]) => isTerminalState(state))
    .map(([sessionId, state]) => `${sessionId}:${state}`)
    .sort()
    .join('\u0000')
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [terminalCounts, setTerminalCounts] = useState<ExactTerminalCounts>({})
  const mode = useRef<SidebarRemoteMode>({ kind: 'none' })
  const generation = useRef(0)
  const countGeneration = useRef(0)
  const inFlightGeneration = useRef<number | null>(null)
  const projectDisplayNames = useRef(input.projectDisplayNames)
  const requestKey = `${input.filterState ?? ''}\u0001${normalizedQuery}\u0001${statusIdsKey}\u0001${matchingProjectPathsKey}`
  const activeRequestKey = useRef('')

  useEffect(() => {
    projectDisplayNames.current = input.projectDisplayNames
  }, [input.projectDisplayNames])

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
        appendUniqueSidebarSessions(current, hydrated).filter((session) =>
          sidebarSessionMatchesText(session, normalizedQuery, projectDisplayNames.current),
        ),
      )
      const nextOffset = offset + pageIds.length
      mode.current = { kind: 'status', ids, offset: nextOffset }
      setHasMore(nextOffset < ids.length)
    },
    [normalizedQuery],
  )

  const publishSearchPage = useCallback(
    async (
      query: string,
      projectPaths: readonly string[],
      cursor: SidebarSearchCursor | undefined,
      requestGeneration: number,
    ) => {
      const page = await querySidebarSearchPage(projectPaths, query, cursor)
      const hydrated = (await hydrateSidebarSessions(page.ids)).filter(
        (session) => session.archived !== true,
      )
      if (generation.current !== requestGeneration) return
      setSessions((current) => appendUniqueSidebarSessions(current, hydrated))
      mode.current = page.nextCursor
        ? { kind: 'search', query, projectPaths, cursor: page.nextCursor }
        : { kind: 'none' }
      setHasMore(page.nextCursor !== undefined)
    },
    [],
  )

  const publishTerminalPage = useCallback(
    async (state: SidebarTerminalState, cursor: string | undefined, requestGeneration: number) => {
      const page = await queryTerminalSidebarSessions(state, cursor)
      const hydrated = (await hydrateSidebarSessions(page.ids)).filter(
        (session) =>
          session.archived !== true &&
          sidebarSessionMatchesText(session, normalizedQuery, projectDisplayNames.current),
      )
      if (generation.current !== requestGeneration) return
      setSessions((current) => appendUniqueSidebarSessions(current, hydrated))
      if (page.totalCount !== undefined) {
        setTerminalCounts((current) => ({ ...current, [state]: page.totalCount }))
      }
      mode.current = page.nextCursor
        ? { kind: 'terminal', state, cursor: page.nextCursor }
        : { kind: 'none' }
      setHasMore(page.nextCursor !== undefined)
    },
    [normalizedQuery],
  )

  const publishInterruptedPage = useCallback(
    async (cursor: string | undefined, requestGeneration: number) => {
      const page = await queryInterruptedSidebarSessions(cursor)
      const hydrated = await hydrateSidebarSessions(page.ids)
      if (generation.current !== requestGeneration) return
      setSessions((current) => appendUniqueSidebarSessions(current, hydrated))
      mode.current = page.nextCursor
        ? { kind: 'interrupted', cursor: page.nextCursor }
        : { kind: 'none' }
      setHasMore(page.nextCursor !== undefined)
    },
    [],
  )

  useEffect(() => {
    countGeneration.current += 1
    const requestGeneration = countGeneration.current
    void queryTerminalSidebarCounts(terminalStateKey)
      .then((result) => {
        if (
          countGeneration.current === requestGeneration &&
          result.refreshKey === terminalStateKey
        ) {
          setTerminalCounts(result.counts)
        }
      })
      .catch(() => undefined)
  }, [terminalStateKey])

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
    if (isTerminalState(input.filterState)) {
      const terminalState = input.filterState
      mode.current = { kind: 'terminal', state: terminalState }
      runPage(requestGeneration, () =>
        publishTerminalPage(terminalState, undefined, requestGeneration),
      )
      return
    }
    if (input.filterState !== null) {
      mode.current = { kind: 'status', ids: stableStatusIds, offset: 0 }
      runPage(requestGeneration, () => publishStatusPage(stableStatusIds, 0, requestGeneration))
      return
    }
    if (normalizedQuery !== '') {
      if ([...normalizedQuery].length < REMOTE_SIDEBAR_SEARCH_MINIMUM_LENGTH) {
        mode.current = { kind: 'none' }
        return
      }
      mode.current = {
        kind: 'search',
        query: normalizedQuery,
        projectPaths: stableMatchingProjectPaths,
      }
      const searchDelay = window.setTimeout(() => {
        runPage(requestGeneration, () =>
          publishSearchPage(
            normalizedQuery,
            stableMatchingProjectPaths,
            undefined,
            requestGeneration,
          ),
        )
      }, REMOTE_SIDEBAR_SEARCH_DEBOUNCE_MS)
      return () => window.clearTimeout(searchDelay)
    }
    mode.current = { kind: 'none' }
  }, [
    input.filterState,
    normalizedQuery,
    publishSearchPage,
    publishInterruptedPage,
    publishStatusPage,
    publishTerminalPage,
    requestKey,
    runPage,
    stableMatchingProjectPaths,
    stableStatusIds,
  ])

  const loadMore = useCallback(() => {
    const current = mode.current
    if (current.kind === 'none') return
    const requestGeneration = generation.current
    if (current.kind === 'search') {
      runPage(requestGeneration, () =>
        publishSearchPage(current.query, current.projectPaths, current.cursor, requestGeneration),
      )
      return
    }
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
    if (current.kind === 'terminal') {
      runPage(requestGeneration, () =>
        publishTerminalPage(current.state, current.cursor, requestGeneration),
      )
    }
  }, [publishInterruptedPage, publishSearchPage, publishStatusPage, publishTerminalPage, runPage])

  const visibleSessions = useMemo(() => {
    return mergeVisibleSidebarSessions({
      loadedSessions: input.loadedSessions,
      remoteSessions: sessions,
      filterState: input.filterState,
      stateBySessionId: input.stateBySessionId,
      normalizedQuery,
      projectDisplayNames: input.projectDisplayNames,
    })
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
    terminalCounts,
  }
}
