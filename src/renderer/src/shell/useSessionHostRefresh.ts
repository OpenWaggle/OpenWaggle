import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { isSessionlessHostEvent } from '@shared/types/session-host-event'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import {
  invalidateDefaultThinkingLevel,
  reconcileQueuedRunStarts,
  sessionFollowUpQueueOptions,
  type useChat,
} from '@/features/chat/hooks'
import { useBackgroundRunStore } from '@/features/chat/state'
import type { useSessions } from '@/features/sessions/hooks'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { invalidateExtensionContributionsQueries } from '@/queries/extensions'
import { queryKeys } from '@/queries/query-keys'
import { api } from '@/shared/lib/ipc'

const SESSION_QUERY_ROOT_SEGMENTS = 2

type ChatLifecycle = Pick<
  ReturnType<typeof useChat>,
  'activeSessionId' | 'loadSessions' | 'refreshSession' | 'updateSessionTitle'
>
type SessionTreeLifecycle = Pick<
  ReturnType<typeof useSessions>,
  'loadSessions' | 'refreshCatalogSessions' | 'refreshSessionTree'
>

interface PendingSessionHostRefresh {
  readonly sessionIds: Set<string>
  /** Sessions whose catalog entry alone changed (a pin, a read receipt): only that is re-read. */
  readonly catalogEntrySessionIds: Set<string>
  readonly queueSessionIds: Set<string>
  catalog: boolean
  archivedBranches: boolean
  relationshipMayHaveChanged: boolean
  scheduled: boolean
}

type HostCursor = { readonly hostInstanceId: string; readonly sequence: number }

/** No route renders an archived or deleted Session: forget its status and cached transcript. */
function forgetRemovedSession(sessionId: SessionId) {
  useSessionStatusStore.getState().clearStatus(sessionId)
  useBackgroundRunStore.getState().clearRunRenderSnapshot(sessionId)
}

function acceptsHostEvent(cursor: HostCursor, previous: HostCursor | null) {
  return !previous ||
    cursor.hostInstanceId !== previous.hostInstanceId ||
    cursor.sequence > previous.sequence
    ? cursor
    : null
}

/**
 * Whether a Worker in `needs_attention` is stuck depends on its parent's Run and queue, read when
 * the Worker's summary is (ADR 0059). So when a parent's state changes, its loaded Workers in that
 * state are read again too, and the Queen's sidebar line follows the parent live.
 */
export function withStuckCandidateWorkers(
  sessionIds: ReadonlySet<string>,
  sessions: readonly SessionSummary[],
) {
  const workers = sessions
    .filter(
      (session) =>
        session.lineage?.delegationState === 'needs_attention' &&
        session.lineage.parentSessionId !== undefined &&
        sessionIds.has(String(session.lineage.parentSessionId)),
    )
    .map((session) => String(session.id))
  return [...new Set([...sessionIds, ...workers])]
}

function takePendingSessionHostRefresh(
  pending: PendingSessionHostRefresh,
  activeSessionId: ChatLifecycle['activeSessionId'],
) {
  const refreshActiveSession = activeSessionId ? pending.sessionIds.has(activeSessionId) : false
  const refresh = {
    catalog: pending.catalog,
    archivedBranches: pending.archivedBranches,
    catalogSessionIds: withStuckCandidateWorkers(
      pending.sessionIds,
      useSessionStore.getState().sessions,
    ).map(SessionId),
    catalogEntrySessionIds: [...pending.catalogEntrySessionIds]
      .filter((sessionId) => !pending.sessionIds.has(sessionId))
      .map(SessionId),
    queueSessionIds: [...pending.queueSessionIds],
    refreshActiveSession,
    refreshActiveTree: Boolean(
      activeSessionId && (refreshActiveSession || pending.relationshipMayHaveChanged),
    ),
  }
  pending.catalog = false
  pending.archivedBranches = false
  pending.relationshipMayHaveChanged = false
  pending.scheduled = false
  pending.sessionIds.clear()
  pending.catalogEntrySessionIds.clear()
  pending.queueSessionIds.clear()
  return refresh
}

function invalidateSessionHostQueries(
  queryClient: QueryClient,
  refresh: ReturnType<typeof takePendingSessionHostRefresh>,
) {
  for (const sessionId of refresh.queueSessionIds) {
    void queryClient.invalidateQueries(sessionFollowUpQueueOptions(SessionId(sessionId)))
  }
  if (refresh.catalog) {
    // Project Actions are no longer polled (B7/D9): a Session's Run starting or settling is when
    // its agent may have started an action, changed the catalog, or birthed a worktree.
    void queryClient.invalidateQueries({ queryKey: queryKeys.projectActions })
  }
  if (refresh.archivedBranches) {
    // Archiving, restoring, and deleting anywhere (another window, the CLI, Hive cleanup)
    // changes what Settings > Archived items lists.
    void queryClient.invalidateQueries({ queryKey: queryKeys.archivedItems })
  }
}

function invalidateSessionHostResyncQueries(queryClient: QueryClient) {
  const queryKey = sessionFollowUpQueueOptions(null).queryKey.slice(0, SESSION_QUERY_ROOT_SEGMENTS)
  void queryClient.invalidateQueries({ queryKey })
  // A missed agent_start or settlement cannot be replayed: drop marks the Host reports idle.
  void reconcileQueuedRunStarts(queryClient)
  void queryClient.invalidateQueries({ queryKey: queryKeys.archivedItems })
  // A missed default change cannot be replayed either.
  void invalidateDefaultThinkingLevel(queryClient)
  void invalidateExtensionContributionsQueries(queryClient)
}

type SessionHostRefresh = ReturnType<typeof takePendingSessionHostRefresh>

function emptyPendingRefresh(): PendingSessionHostRefresh {
  return {
    sessionIds: new Set(),
    catalogEntrySessionIds: new Set(),
    queueSessionIds: new Set(),
    catalog: false,
    archivedBranches: false,
    relationshipMayHaveChanged: false,
    scheduled: false,
  }
}

/** The catalog entries to read again: every changed Session's, or only those of entry changes. */
function catalogRefreshSessionIds(refresh: SessionHostRefresh) {
  if (refresh.catalog) return [...refresh.catalogSessionIds, ...refresh.catalogEntrySessionIds]
  return refresh.catalogEntrySessionIds
}

function applySessionHostRefresh(
  refresh: SessionHostRefresh,
  input: {
    readonly activeSessionId: ChatLifecycle['activeSessionId']
    readonly refreshCatalogSessions: SessionTreeLifecycle['refreshCatalogSessions']
    readonly refreshSession: ChatLifecycle['refreshSession']
    readonly refreshSessionTree: SessionTreeLifecycle['refreshSessionTree']
  },
) {
  if (refresh.catalog) useSessionStatusStore.getState().noteHostTerminalCountChange()
  const catalogSessionIds = catalogRefreshSessionIds(refresh)
  if (refresh.catalog || catalogSessionIds.length > 0) {
    void input.refreshCatalogSessions(catalogSessionIds)
  }
  const { activeSessionId } = input
  if (!activeSessionId) return
  if (refresh.refreshActiveSession) void input.refreshSession(activeSessionId)
  if (refresh.refreshActiveTree) void input.refreshSessionTree(SessionId(String(activeSessionId)))
}

export function useSessionHostRefresh(input: {
  readonly activeSessionId: ChatLifecycle['activeSessionId']
  readonly loadChatSessions: ChatLifecycle['loadSessions']
  readonly loadSessionTrees: SessionTreeLifecycle['loadSessions']
  readonly refreshCatalogSessions: SessionTreeLifecycle['refreshCatalogSessions']
  readonly refreshSession: ChatLifecycle['refreshSession']
  readonly refreshSessionTree: SessionTreeLifecycle['refreshSessionTree']
  readonly updateSessionTitle: ChatLifecycle['updateSessionTitle']
}) {
  const {
    activeSessionId,
    loadChatSessions,
    loadSessionTrees,
    refreshCatalogSessions,
    refreshSession,
    refreshSessionTree,
    updateSessionTitle,
  } = input
  const queryClient = useQueryClient()
  const latestHostCursor = useRef<HostCursor | null>(null)
  const pendingRefresh = useRef<PendingSessionHostRefresh>(emptyPendingRefresh())
  useEffect(
    () =>
      api.onSessionTitleUpdated(({ sessionId, title }) => {
        updateSessionTitle(sessionId, title)
      }),
    [updateSessionTitle],
  )
  useEffect(() => {
    let active = true
    const flush = () => {
      if (!active) return
      const refresh = takePendingSessionHostRefresh(pendingRefresh.current, activeSessionId)
      invalidateSessionHostQueries(queryClient, refresh)
      applySessionHostRefresh(refresh, {
        activeSessionId,
        refreshCatalogSessions,
        refreshSession,
        refreshSessionTree,
      })
    }
    const schedule = () => {
      if (pendingRefresh.current.scheduled) return
      pendingRefresh.current.scheduled = true
      queueMicrotask(flush)
    }
    const unsubscribe = api.onSessionHostEvent((event) => {
      const accepted = acceptsHostEvent(event.cursor, latestHostCursor.current)
      if (!accepted) return
      latestHostCursor.current = accepted
      if (event.payload.kind === 'default-thinking-level-changed') {
        void invalidateDefaultThinkingLevel(queryClient)
        return
      }
      if (isSessionlessHostEvent(event.payload)) return
      const { sessionId } = event.payload
      if (event.payload.kind === 'session-list-changed' && event.payload.catalogOnly === true) {
        pendingRefresh.current.catalogEntrySessionIds.add(sessionId)
        schedule()
        return
      }
      if (
        event.payload.kind === 'session-list-changed' &&
        (event.payload.change === 'archived' || event.payload.change === 'deleted')
      ) {
        forgetRemovedSession(SessionId(sessionId))
      }
      if (event.payload.kind === 'session-list-changed' && event.payload.change === 'deleted') {
        pendingRefresh.current.relationshipMayHaveChanged = true
      }
      if (event.payload.kind === 'session-list-changed') {
        pendingRefresh.current.archivedBranches = true
      }
      pendingRefresh.current.sessionIds.add(sessionId)
      if (
        event.payload.kind === 'session-state-changed' ||
        event.payload.kind === 'session-list-changed'
      ) {
        pendingRefresh.current.catalog = true
        pendingRefresh.current.queueSessionIds.add(sessionId)
      }
      schedule()
    })
    return () => {
      active = false
      pendingRefresh.current.scheduled = false
      pendingRefresh.current.catalog = false
      pendingRefresh.current.archivedBranches = false
      pendingRefresh.current.relationshipMayHaveChanged = false
      pendingRefresh.current.sessionIds.clear()
      pendingRefresh.current.catalogEntrySessionIds.clear()
      pendingRefresh.current.queueSessionIds.clear()
      unsubscribe()
    }
  }, [activeSessionId, refreshCatalogSessions, queryClient, refreshSession, refreshSessionTree])
  useEffect(() => {
    return api.onSessionHostResyncRequired(() => {
      useSessionStatusStore.getState().noteHostTerminalCountChange()
      invalidateSessionHostResyncQueries(queryClient)
      void loadChatSessions()
      void loadSessionTrees()
      if (activeSessionId) {
        void refreshSession(activeSessionId)
        void refreshSessionTree(SessionId(String(activeSessionId)))
      }
    })
  }, [
    activeSessionId,
    loadChatSessions,
    loadSessionTrees,
    queryClient,
    refreshSession,
    refreshSessionTree,
  ])
}
