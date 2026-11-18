import type { SessionSummary } from '@shared/types/session'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import { useEffect, useRef, useState } from 'react'
import { useSessionStatusStore } from '@/features/sessions/state'
import { api } from '@/shared/lib/ipc'
import { sessionHasInterruptedRun } from '../lib/sidebar-row-state'

/** What the Host count depends on in the loaded catalog: its Sessions and their interruptions. */
function interruptedCatalogKey(sessions: readonly SessionSummary[]) {
  let key = String(sessions.length)
  for (const session of sessions) {
    if (session.archived !== true && sessionHasInterruptedRun(session)) key += `|${session.id}`
  }
  return key
}

function loadedInterruptedCount(sessions: readonly SessionSummary[]) {
  return sessions.filter(
    (session) => session.archived !== true && sessionHasInterruptedRun(session),
  ).length
}

/** Exact interrupted Session count from the indexed Host projection. */
export function useInterruptedSessionCount(sessions: readonly SessionSummary[]) {
  const [count, setCount] = useState(() => loadedInterruptedCount(sessions))
  // Re-count when the loaded catalog's interruptions change, not on every new array of the same
  // Sessions: startup rebuilt it three times and asked the Host three times (boot fetch dedupe).
  // The Host counts every Session, so a change it reports to a Session beyond the loaded catalog
  // (its count revision) re-counts too.
  const hostRevision = useSessionStatusStore((state) => state.hostTerminalCountRevision)
  const catalogKey = `${String(hostRevision)}#${interruptedCatalogKey(sessions)}`
  const fallbackCount = loadedInterruptedCount(sessions)
  const countedKey = useRef<string | null>(null)
  const generation = useRef(0)

  useEffect(
    () => () => {
      generation.current += 1
    },
    [],
  )

  useEffect(() => {
    if (countedKey.current === catalogKey) return
    countedKey.current = catalogKey
    generation.current += 1
    const current = generation.current
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
        if (generation.current !== current) return
        if (response.outcome.operation !== 'list' || !('sessions' in response.outcome)) return
        setCount(response.outcome.totalCount ?? response.outcome.sessions.length)
      })
      .catch(() => {
        if (generation.current === current) setCount(fallbackCount)
      })
  })

  return count
}
