import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'

/**
 * Sessions the Host reported archived or deleted, and a token that changes when the Host asks for
 * a resync.
 *
 * Remote sidebar pages are snapshots. A session archived or deleted after its page loaded stayed
 * in a filtered or searched sidebar, so an archive looked like it had not happened. Filtering the
 * rendered rows through this set, rather than editing the pages, also covers a page request that
 * was already in flight when the event arrived. Events missed during a Host restart cannot be
 * replayed, so a resync restarts the remote request instead.
 */
export function useRemovedRemoteSessions() {
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set())
  const [resyncToken, setResyncToken] = useState(0)

  useEffect(() => {
    if (typeof api.onSessionHostEvent !== 'function') return
    return api.onSessionHostEvent((event) => {
      const payload = event.payload
      if (payload.kind !== 'session-list-changed') return
      const { change, sessionId } = payload
      if (change !== 'archived' && change !== 'deleted' && change !== 'unarchived') return
      setRemoved((current) => {
        const listed = !current.has(sessionId)
        if ((change === 'unarchived') === listed) return current
        const next = new Set(current)
        if (change === 'unarchived') next.delete(sessionId)
        else next.add(sessionId)
        return next
      })
    })
  }, [])

  useEffect(() => {
    if (typeof api.onSessionHostResyncRequired !== 'function') return
    return api.onSessionHostResyncRequired(() => setResyncToken((token) => token + 1))
  }, [])

  return { removed, resyncToken }
}
