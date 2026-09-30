import type { SessionId } from '@shared/types/brand'
import type { RegisteredRouter } from '@tanstack/react-router'

type Router = RegisteredRouter

/** The `node` routed for this Session, `null` without one, `undefined` off this Session. */
function routedNode(router: Router, sessionId: SessionId) {
  const { pathname, search } = router.state.location
  if (pathname !== `/sessions/${String(sessionId)}`) return undefined
  return typeof search.node === 'string' ? search.node : null
}

/**
 * Remembers the conversation node routed when a send starts, and returns a function that drops it
 * once the send is delivered, so the view follows the head of the branch the send extended.
 *
 * A retry or branch switch routes to the node it continues from. Kept after the send, that node
 * pinned the view below the new messages, and a reload showed the branch without them. A send can
 * settle minutes later, so nothing happens once the user has moved to another page, Session, or
 * node in the meantime.
 */
export function trackRoutedNode(router: Router, sessionId: SessionId) {
  const nodeAtSend = routedNode(router, sessionId)
  return function followBranchHead() {
    if (!nodeAtSend || routedNode(router, sessionId) !== nodeAtSend) return
    void router.navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: String(sessionId) },
      search: (previous) => ({ ...previous, node: undefined }),
      replace: true,
    })
  }
}
