import type { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import type { SessionDetailCursor } from '@shared/types/session-transcript-window'

/**
 * Session detail reads that move only what changed (v1 performance, D5).
 *
 * Every Host event, Run end and focus refreshed a Session's whole detail, every message of its
 * active path, though usually nothing or one turn had changed. Each read now names the messages
 * this window holds; while the Session's nodes were only appended to since, the Host returns the
 * messages after them, and the detail is put back together here. Unchanged messages keep their
 * object identity.
 *
 * The window holds only the newest `SESSION_DETAIL_MESSAGE_WINDOW` messages of a Session (ADR
 * 0036): the transcript renders the Session's workspace, whose own window reaches further back
 * page by page, and reads the detail for the live end of the conversation. A long Session's open
 * therefore moves that window instead of its whole history. `messagesWindow` says where the held
 * messages start.
 *
 * Reads of one Session never overlap: a read asked for while another is in flight runs once that
 * one is done, with its cursor, so it moves only what changed in between. Every call asked for
 * during a read shares that one trailing read.
 */

type DetailRead = (id: SessionId, cursor?: SessionDetailCursor) => Promise<SessionDetail | null>

/**
 * Newest messages of a Session the window holds: above the 200 path entries of the transcript's
 * first workspace page, so every message it shows at first is held, with room for a long Run.
 */
export const SESSION_DETAIL_MESSAGE_WINDOW = 400

/** Sessions whose messages are held; a long Session's messages are the chat view's anyway. */
const MAX_HELD_SESSIONS = 8

interface HeldDetail {
  readonly nodeMutationRevision: number
  readonly messages: SessionDetail['messages']
  /** Messages of the active path before the first held one. */
  readonly startIndex: number
}

/** The cursor for a read; with nothing held, the Host returns the newest messages and the revision. */
function cursorFor(held: HeldDetail | undefined): SessionDetailCursor {
  if (!held) {
    return {
      nodeMutationRevision: 0,
      messageCount: 0,
      lastMessageId: null,
      maxMessages: SESSION_DETAIL_MESSAGE_WINDOW,
    }
  }
  const last = held.messages.at(-1)
  return {
    nodeMutationRevision: held.nodeMutationRevision,
    messageCount: held.startIndex + held.messages.length,
    lastMessageId: last ? String(last.id) : null,
    maxMessages: SESSION_DETAIL_MESSAGE_WINDOW,
  }
}

/** The messages a reply means, with where they start, or null when it continues unheld ones. */
function replyMessages(detail: SessionDetail, held: HeldDetail | undefined) {
  const base = detail.messagesDelta?.baseMessageCount ?? 0
  if (base === 0) {
    return { messages: detail.messages, startIndex: detail.messagesWindow?.startIndex ?? 0 }
  }
  const kept = held ? base - held.startIndex : -1
  if (!held || kept < 0 || kept > held.messages.length) return null
  return {
    messages: kept === 0 ? detail.messages : [...held.messages.slice(0, kept), ...detail.messages],
    startIndex: held.startIndex,
  }
}

function completeDetail(detail: SessionDetail, held: HeldDetail | undefined): SessionDetail | null {
  const replied = replyMessages(detail, held)
  if (!replied) return null
  const { messagesDelta: _delta, messagesWindow: _window, ...rest } = detail
  const dropped = Math.max(0, replied.messages.length - SESSION_DETAIL_MESSAGE_WINDOW)
  const messages = dropped === 0 ? replied.messages : replied.messages.slice(dropped)
  const startIndex = replied.startIndex + dropped
  return {
    ...rest,
    messages,
    ...(startIndex === 0
      ? {}
      : { messagesWindow: { startIndex, pathLength: startIndex + messages.length } }),
  }
}

interface DetailFlight {
  readonly promise: Promise<SessionDetail | null>
  trailing: Promise<SessionDetail | null> | null
}

export function createSessionDetailReader(read: DetailRead) {
  const heldBySession = new Map<string, HeldDetail>()
  const flights = new Map<string, DetailFlight>()

  function remember(id: SessionId, detail: SessionDetail | null) {
    const key = String(id)
    heldBySession.delete(key)
    if (!detail || detail.nodeMutationRevision === undefined) return
    heldBySession.set(key, {
      nodeMutationRevision: detail.nodeMutationRevision,
      messages: detail.messages,
      startIndex: detail.messagesWindow?.startIndex ?? 0,
    })
    while (heldBySession.size > MAX_HELD_SESSIONS) {
      const oldest = heldBySession.keys().next().value
      if (oldest === undefined) break
      heldBySession.delete(oldest)
    }
  }

  async function readOnce(id: SessionId): Promise<SessionDetail | null> {
    // The cursor and what it names are taken together, so a reply is completed from exactly the
    // messages it continues.
    const held = heldBySession.get(String(id))
    const reply = await read(id, cursorFor(held))
    if (!reply) {
      remember(id, null)
      return null
    }
    let complete = completeDetail(reply, held)
    if (!complete) {
      const whole = await read(id, cursorFor(undefined))
      complete = whole ? completeDetail(whole, undefined) : null
    }
    remember(id, complete)
    return complete
  }

  function start(id: SessionId) {
    const key = String(id)
    const flight: DetailFlight = { promise: readOnce(id), trailing: null }
    flights.set(key, flight)
    const settle = () => {
      if (flights.get(key) === flight) flights.delete(key)
    }
    flight.promise.then(settle, settle)
    return flight.promise
  }

  return function readSessionDetail(id: SessionId): Promise<SessionDetail | null> {
    const current = flights.get(String(id))
    if (!current) return start(id)
    current.trailing ??= current.promise.then(
      () => start(id),
      () => start(id),
    )
    return current.trailing
  }
}
