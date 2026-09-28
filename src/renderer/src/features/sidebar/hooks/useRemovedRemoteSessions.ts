import type { SessionSummary } from '@shared/types/session'
import { useEffect } from 'react'
import { api } from '@/shared/lib/ipc'

type SetSessions = (
  update: (current: readonly SessionSummary[]) => readonly SessionSummary[],
) => void

/**
 * Remote sidebar pages are snapshots. A session archived or deleted after its page loaded stayed
 * in a filtered or searched sidebar, so an archive looked like it had not happened. The Host
 * reports both changes, whoever made them, so the snapshot drops the row as soon as it hears.
 */
export function useDropRemovedRemoteSessions(setSessions: SetSessions) {
  useEffect(() => {
    if (typeof api.onSessionHostEvent !== 'function') return
    return api.onSessionHostEvent((event) => {
      const payload = event.payload
      if (payload.kind !== 'session-list-changed') return
      if (payload.change !== 'archived' && payload.change !== 'deleted') return
      setSessions((current) =>
        current.some((session) => String(session.id) === payload.sessionId)
          ? current.filter((session) => String(session.id) !== payload.sessionId)
          : current,
      )
    })
  }, [setSessions])
}
