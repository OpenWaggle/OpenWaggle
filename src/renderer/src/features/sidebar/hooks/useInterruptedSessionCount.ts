import type { SessionSummary } from '@shared/types/session'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { sessionHasInterruptedRun } from '../lib/sidebar-row-state'

function loadedInterruptedCount(sessions: readonly SessionSummary[]) {
  return sessions.filter(
    (session) => session.archived !== true && sessionHasInterruptedRun(session),
  ).length
}

/** Exact interrupted Session count from the indexed Host projection. */
export function useInterruptedSessionCount(sessions: readonly SessionSummary[]) {
  const [count, setCount] = useState(() => loadedInterruptedCount(sessions))

  useEffect(() => {
    let active = true
    void api
      .querySessionControl({
        contractVersion: SESSION_QUERY_CONTRACT_VERSION,
        requestId: crypto.randomUUID(),
        query: {
          operation: 'list',
          archived: false,
          interrupted: true,
          limit: 1,
        },
      })
      .then((response) => {
        if (!active || response.outcome.operation !== 'list' || !('sessions' in response.outcome)) {
          return
        }
        setCount(response.outcome.totalCount ?? response.outcome.sessions.length)
      })
      .catch(() => {
        if (active) setCount(loadedInterruptedCount(sessions))
      })
    return () => {
      active = false
    }
  }, [sessions])

  return count
}
