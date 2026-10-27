import type { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import type { SessionDetailCursor } from '@shared/types/session-transcript-window'

/**
 * Session detail reads that move only what changed (v1 performance, D5).
 *
 * Every Host event, Run end and focus refreshed a Session's whole detail, every message of its
 * active path, though usually nothing or one turn had changed. Each read now names the messages
 * this window holds; while the Session's nodes were only appended to since, the Host returns the
 * messages after them, and the full detail is put back together here. Callers keep receiving a
 * complete `SessionDetail`, and unchanged messages keep their object identity.
 */

type DetailRead = (id: SessionId, cursor?: SessionDetailCursor) => Promise<SessionDetail | null>

/** Sessions whose messages are held; a long Session's messages are the chat view's anyway. */
const MAX_HELD_SESSIONS = 8

interface HeldDetail {
  readonly nodeMutationRevision: number
  readonly messages: SessionDetail['messages']
}

/** The cursor for a read; with nothing held, the Host returns every message and its revision. */
function cursorFor(held: HeldDetail | undefined): SessionDetailCursor {
  if (!held) return { nodeMutationRevision: 0, messageCount: 0, lastMessageId: null }
  const last = held.messages.at(-1)
  return {
    nodeMutationRevision: held.nodeMutationRevision,
    messageCount: held.messages.length,
    lastMessageId: last ? String(last.id) : null,
  }
}

function completeDetail(detail: SessionDetail, held: HeldDetail | undefined): SessionDetail | null {
  const { messagesDelta, ...rest } = detail
  if (!messagesDelta) return rest
  if (messagesDelta.baseMessageCount === 0) return rest
  if (!held || held.messages.length < messagesDelta.baseMessageCount) return null
  return {
    ...rest,
    messages: [...held.messages.slice(0, messagesDelta.baseMessageCount), ...detail.messages],
  }
}

export function createSessionDetailReader(read: DetailRead) {
  const heldBySession = new Map<string, HeldDetail>()

  function remember(id: SessionId, detail: SessionDetail | null) {
    const key = String(id)
    heldBySession.delete(key)
    if (!detail || detail.nodeMutationRevision === undefined) return
    heldBySession.set(key, {
      nodeMutationRevision: detail.nodeMutationRevision,
      messages: detail.messages,
    })
    while (heldBySession.size > MAX_HELD_SESSIONS) {
      const oldest = heldBySession.keys().next().value
      if (oldest === undefined) break
      heldBySession.delete(oldest)
    }
  }

  return async function readSessionDetail(id: SessionId): Promise<SessionDetail | null> {
    // The cursor and what it names are taken together, so a reply is completed from exactly the
    // messages it continues even when another read replaced the held ones meanwhile.
    const held = heldBySession.get(String(id))
    const reply = await read(id, cursorFor(held))
    if (!reply) {
      remember(id, null)
      return null
    }
    const detail = completeDetail(reply, held) ?? (await read(id, cursorFor(undefined)))
    const complete = detail ? completeDetail(detail, undefined) : null
    remember(id, complete)
    return complete
  }
}
