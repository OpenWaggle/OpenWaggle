import { matchBy } from '@diegogbrisa/ts-match'
import type { SessionId } from '@shared/types/brand'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import { type SessionStatus, TERMINAL_STATUSES } from '@shared/types/session-status'
import { useEffect } from 'react'
import { isTerminalTransportEvent } from '@/features/chat/lib'
import { useBackgroundRunStore, useChatStore } from '@/features/chat/state'
import { useSessionStatusStore } from '@/features/sessions/state/session-status-store'
import { useSessionStore } from '@/features/sessions/state/session-store'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

/** Set of session IDs that are currently in a waggle run. */
const activeWaggleSessions = new Set<SessionId>()
const RUNTIME_HYDRATION_CONCURRENCY = 8
const logger = createRendererLogger('session-status-monitor')

async function hydrateLiveSessionStatuses(input: {
  readonly cancelled: () => boolean
  readonly setStatus: (sessionId: SessionId, status: SessionStatus, updatedAt?: number) => void
}) {
  const runs = await api.listActiveRuns()
  if (input.cancelled()) return

  for (const run of runs) input.setStatus(run.sessionId, 'working', run.startedAt)
  if (typeof api.querySessionControl !== 'function') return

  for (let offset = 0; offset < runs.length; offset += RUNTIME_HYDRATION_CONCURRENCY) {
    const pages = await Promise.allSettled(
      runs.slice(offset, offset + RUNTIME_HYDRATION_CONCURRENCY).map(async (run) => {
        const response = await api.querySessionControl({
          contractVersion: SESSION_QUERY_CONTRACT_VERSION,
          requestId: crypto.randomUUID(),
          query: { operation: 'requests-list', sessionId: run.sessionId },
        })
        if (response.outcome.operation !== 'requests-list' || !('requests' in response.outcome)) {
          return null
        }
        const oldest = response.outcome.requests.reduce<number | null>(
          (current, request) =>
            current === null || request.createdAt < current ? request.createdAt : current,
          null,
        )
        return oldest === null ? null : { sessionId: run.sessionId, createdAt: oldest }
      }),
    )
    if (input.cancelled()) return
    for (const page of pages) {
      if (page.status === 'rejected') {
        logger.warn('Failed to hydrate pending Session interaction', {
          error: String(page.reason),
        })
        continue
      }
      if (!page.value) continue
      input.setStatus(page.value.sessionId, 'awaiting-input', page.value.createdAt)
    }
  }
}

/**
 * Subscribes to agent lifecycle events and maintains per-session status
 * in the session-status store. Mounted once at workspace level.
 *
 * When a terminal status arrives for the currently active session,
 * it is immediately marked as visited so the icon doesn't flash.
 */
export function useSessionStatusMonitor(): void {
  const setStatus = useSessionStatusStore((s) => s.setStatus)
  const setPhase = useSessionStatusStore((s) => s.setPhase)
  const markVisited = useSessionStatusStore((s) => s.markVisited)
  const hydratePersistedStatuses = useSessionStatusStore((s) => s.hydratePersistedStatuses)
  const catalogSessions = useSessionStore((s) => s.sessions)

  useEffect(() => {
    hydratePersistedStatuses(catalogSessions)
  }, [catalogSessions, hydratePersistedStatuses])

  useEffect(() => {
    let cancelled = false

    function setStatusWithVisitCheck(
      sessionId: SessionId,
      status: SessionStatus,
      updatedAt?: number,
    ) {
      setStatus(sessionId, status, updatedAt)
      // If the user is currently viewing this session and it's a terminal status, auto-mark visited
      if (TERMINAL_STATUSES.has(status)) {
        const activeId = useChatStore.getState().activeSessionId
        if (sessionId === activeId) {
          markVisited(sessionId)
        }
      }
    }

    const unsubPhase = api.onAgentPhase(({ sessionId, phase }) => {
      // Keep the label, not just the fact that something happened. A row can then say what
      // the agent is doing rather than repeating that it is busy.
      setPhase(sessionId, phase?.label ?? null)
      if (!phase) return
      // Don't downgrade waggle-running to working
      if (activeWaggleSessions.has(sessionId)) return
      setStatusWithVisitCheck(sessionId, 'working')
    })

    const unsubCompleted = api.onRunCompleted(({ sessionId }) => {
      activeWaggleSessions.delete(sessionId)
      setStatusWithVisitCheck(sessionId, 'completed')
      void useBackgroundRunStore.getState().reconcileTerminalRun(sessionId)
    })

    const unsubWorktreeLaunch = api.onWorktreeLaunch(({ sessionId, launch }) => {
      useBackgroundRunStore.getState().setWorktreeLaunch(sessionId, launch)
      if (launch?.status === 'running') {
        setStatusWithVisitCheck(sessionId, 'connecting')
      }
    })

    const unsubWaggleTurn = api.onWaggleTurnEvent(({ sessionId, event }) => {
      matchBy(event, 'type')
        .with('collaboration-pending', 'turn-start', () => {
          activeWaggleSessions.add(sessionId)
          setStatusWithVisitCheck(sessionId, 'waggle-running')
        })
        // Terminal waggle events transition to 'completed' via onRunCompleted above.
        .otherwise(() => undefined)
    })

    const unsubEvent = api.onAgentEvent(({ sessionId, event }) => {
      matchBy(event, 'type')
        .with('agent_start', () => {
          if (!activeWaggleSessions.has(sessionId)) {
            setStatusWithVisitCheck(sessionId, 'connecting', event.timestamp)
          }
        })
        .with('agent_end', (value) => {
          if (value.reason === 'error') {
            setStatusWithVisitCheck(sessionId, 'error', value.timestamp)
            return
          }
          if (isTerminalTransportEvent(value)) {
            setStatusWithVisitCheck(sessionId, 'completed', value.timestamp)
          }
        })
        .with('agent_interaction_request', (value) => {
          if (value.interaction.kind !== 'notify') {
            setStatusWithVisitCheck(sessionId, 'awaiting-input', value.timestamp)
          }
        })
        .with('agent_interaction_resolved', (value) => {
          if (value.kind === 'notify') return
          setStatusWithVisitCheck(
            sessionId,
            activeWaggleSessions.has(sessionId) ? 'waggle-running' : 'working',
            value.timestamp,
          )
        })
        .with('message_update', (value) => {
          matchBy(value.assistantMessageEvent, 'type')
            .with('text_delta', 'toolcall_start', () => {
              if (!activeWaggleSessions.has(sessionId)) {
                setStatusWithVisitCheck(sessionId, 'working')
              }
            })
            .otherwise(() => undefined)
        })
        .with('tool_execution_start', () => {
          if (!activeWaggleSessions.has(sessionId)) {
            setStatusWithVisitCheck(sessionId, 'working')
          }
        })
        .otherwise((value) => {
          if (isTerminalTransportEvent(value)) {
            setStatusWithVisitCheck(sessionId, 'completed')
          }
        })
    })

    void hydrateLiveSessionStatuses({
      cancelled: () => cancelled,
      setStatus: setStatusWithVisitCheck,
    }).catch((error: unknown) => {
      logger.warn('Failed to hydrate live Session statuses', { error: String(error) })
    })

    return () => {
      cancelled = true
      unsubPhase()
      unsubCompleted()
      unsubWorktreeLaunch()
      unsubWaggleTurn()
      unsubEvent()
    }
  }, [setStatus, setPhase, markVisited])
}
