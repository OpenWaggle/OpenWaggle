import { parseSessionLink } from '@shared/utils/session-link'
import { createLogger } from './logger'
import { broadcastToWindows } from './utils/broadcast'

const logger = createLogger('session-link-requests')

/** Links waiting for the renderer, oldest first; a few is plenty for quick repeats. */
const pendingSessionIds: string[] = []
const PENDING_SESSION_LINK_LIMIT = 8

/**
 * Remember a Session link the user opened and tell renderers to take it. The renderer pulls
 * the request, so a link opened before its window has loaded is not lost and a reload never
 * opens it twice. Anything that is not a Session link is refused here, before any window is
 * raised or told about it (ADR 0056). Returns whether the link was accepted.
 */
export function requestOpenSessionLink(url: string) {
  const sessionId = parseSessionLink(url)
  if (sessionId === null) {
    logger.warn('Ignoring a link that is not a Session link', { length: url.length })
    return false
  }
  if (pendingSessionIds.at(-1) !== sessionId) pendingSessionIds.push(sessionId)
  if (pendingSessionIds.length > PENDING_SESSION_LINK_LIMIT) pendingSessionIds.shift()
  broadcastToWindows('app:open-session-link-requested', null)
  return true
}

/** The oldest waiting Session identity, or `null`; each request is handed out once. */
export function takeOpenSessionLinkRequest() {
  return pendingSessionIds.shift() ?? null
}
