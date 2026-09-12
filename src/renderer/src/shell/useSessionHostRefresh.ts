import { SessionId } from '@shared/types/brand'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { sessionFollowUpQueueOptions, type useChat } from '@/features/chat/hooks'
import type { useSessions } from '@/features/sessions/hooks'
import { useSessionStatusStore } from '@/features/sessions/state'
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
  readonly queueSessionIds: Set<string>
  catalog: boolean
  relationshipMayHaveChanged: boolean
  scheduled: boolean
}

function acceptsHostEvent(
  cursor: { readonly hostInstanceId: string; readonly sequence: number },
  previous: { readonly hostInstanceId: string; readonly sequence: number } | null,
) {
  return !previous ||
    cursor.hostInstanceId !== previous.hostInstanceId ||
    cursor.sequence > previous.sequence
    ? cursor
    : null
}

function takePendingSessionHostRefresh(
  pending: PendingSessionHostRefresh,
  activeSessionId: ChatLifecycle['activeSessionId'],
) {
  const refreshActiveSession = activeSessionId ? pending.sessionIds.has(activeSessionId) : false
  const refresh = {
    catalog: pending.catalog,
    catalogSessionIds: [...pending.sessionIds].map(SessionId),
    queueSessionIds: [...pending.queueSessionIds],
    refreshActiveSession,
    refreshActiveTree: Boolean(
      activeSessionId && (refreshActiveSession || pending.relationshipMayHaveChanged),
    ),
  }
  pending.catalog = false
  pending.relationshipMayHaveChanged = false
  pending.scheduled = false
  pending.sessionIds.clear()
  pending.queueSessionIds.clear()
  return refresh
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
  const latestHostCursor = useRef<{
    readonly hostInstanceId: string
    readonly sequence: number
  } | null>(null)
  const pendingRefresh = useRef<PendingSessionHostRefresh>({
    sessionIds: new Set(),
    queueSessionIds: new Set(),
    catalog: false,
    relationshipMayHaveChanged: false,
    scheduled: false,
  })
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
      for (const sessionId of refresh.queueSessionIds) {
        void queryClient.invalidateQueries(sessionFollowUpQueueOptions(SessionId(sessionId)))
      }
      if (refresh.catalog) {
        void refreshCatalogSessions(refresh.catalogSessionIds)
      }
      if (refresh.refreshActiveSession && activeSessionId) {
        void refreshSession(activeSessionId)
      }
      if (refresh.refreshActiveTree && activeSessionId) {
        void refreshSessionTree(SessionId(String(activeSessionId)))
      }
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
      if (event.payload.kind === 'semantic-discovery-readiness-changed') return
      const { sessionId } = event.payload
      if (
        event.payload.kind === 'session-list-changed' &&
        (event.payload.change === 'archived' || event.payload.change === 'deleted')
      ) {
        useSessionStatusStore.getState().clearStatus(SessionId(sessionId))
      }
      if (event.payload.kind === 'session-list-changed' && event.payload.change === 'deleted') {
        pendingRefresh.current.relationshipMayHaveChanged = true
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
      pendingRefresh.current.relationshipMayHaveChanged = false
      pendingRefresh.current.sessionIds.clear()
      pendingRefresh.current.queueSessionIds.clear()
      unsubscribe()
    }
  }, [activeSessionId, refreshCatalogSessions, queryClient, refreshSession, refreshSessionTree])
  useEffect(() => {
    return api.onSessionHostResyncRequired(() => {
      const queryKey = sessionFollowUpQueueOptions(null).queryKey.slice(
        0,
        SESSION_QUERY_ROOT_SEGMENTS,
      )
      void queryClient.invalidateQueries({ queryKey })
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
