import type { SessionId } from '@shared/types/brand'
import type { UIMessage, UIMessagePart } from '@shared/types/chat-ui'
import { useSyncExternalStore } from 'react'

/**
 * The newest copy of each Session's streaming assistant message, ahead of React state (B2).
 *
 * A streamed text or reasoning token only lengthens one part of the message that is streaming. It
 * used to replace the chat's message list in React state, which re-rendered the whole chat route
 * (transcript, Session Summary, composer) once per token. Such a token is published here instead,
 * and only that message's bubble re-renders. Any other change commits the chat's message list as
 * before, which carries every token published since.
 *
 * One message per Session: a Session streams one assistant message at a time.
 */
const liveMessages = new Map<SessionId, UIMessage>()
const listeners = new Map<SessionId, Set<() => void>>()

export function publishLiveStreamMessage(sessionId: SessionId, message: UIMessage) {
  liveMessages.set(sessionId, message)
  for (const listener of listeners.get(sessionId) ?? []) listener()
}

/**
 * Forgets a settled Run's live message once React state holds it. Deferred to a later task, so the
 * commit that carries the Run's last tokens renders before the bubble falls back to state, and kept
 * if another message started streaming since.
 */
export function releaseLiveStreamMessage(sessionId: SessionId) {
  const released = liveMessages.get(sessionId)
  if (!released) return
  setTimeout(() => {
    if (liveMessages.get(sessionId) !== released) return
    liveMessages.delete(sessionId)
    for (const listener of listeners.get(sessionId) ?? []) listener()
  }, 0)
}

/** Forgets every live message; for tests, which reuse Session and message ids. */
export function resetLiveStreamMessages() {
  const sessionIds = [...liveMessages.keys()]
  liveMessages.clear()
  for (const sessionId of sessionIds) {
    for (const listener of listeners.get(sessionId) ?? []) listener()
  }
}

/** The messages as the transcript renders them, live copies included. */
export function withLiveStreamMessages(
  sessionId: SessionId | null,
  messages: readonly UIMessage[],
): readonly UIMessage[] {
  const live = sessionId ? liveMessages.get(sessionId) : undefined
  if (!live) return messages
  return messages.map((message) =>
    message.id === live.id && liveMessageIsAhead(live, message) ? live : message,
  )
}

function subscribe(sessionId: SessionId, listener: () => void) {
  let sessionListeners = listeners.get(sessionId)
  if (!sessionListeners) {
    sessionListeners = new Set()
    listeners.set(sessionId, sessionListeners)
  }
  sessionListeners.add(listener)
  return () => {
    sessionListeners.delete(listener)
    if (sessionListeners.size === 0) listeners.delete(sessionId)
  }
}

function streamedText(part: UIMessagePart) {
  return part.type === 'text' || part.type === 'thinking' ? part.content : null
}

/**
 * Whether `live` is `shown` with more streamed text: the same parts, each streamed part's text
 * starting with the shown text, and at least one longer. A shown message that caught up with or
 * passed the live copy (React state committed it, or replaced it) wins.
 */
export function liveMessageIsAhead(live: UIMessage, shown: UIMessage) {
  if (live.id !== shown.id || live.parts.length !== shown.parts.length) return false
  let ahead = false
  for (let index = 0; index < live.parts.length; index += 1) {
    const livePart = live.parts[index]
    const shownPart = shown.parts[index]
    if (!livePart || !shownPart || livePart.type !== shownPart.type) return false
    const liveText = streamedText(livePart)
    const shownText = streamedText(shownPart)
    if (liveText === null || shownText === null) continue
    if (liveText.length < shownText.length || !liveText.startsWith(shownText)) return false
    if (liveText.length > shownText.length) ahead = true
  }
  return ahead
}

function unsubscribeNothing() {}

/**
 * The message to render: the live copy while it streams ahead of the one React state holds. Not
 * limited to a row marked streaming: a steer preview after the reply makes it no longer the last.
 *
 * Bubbles of other messages read `undefined` for their snapshot, so a token re-renders only the
 * bubble of the message it belongs to.
 */
export function useLiveStreamMessage(sessionId: SessionId | null, message: UIMessage): UIMessage {
  const messageId = message.id
  const live = useSyncExternalStore(
    (listener) => (sessionId ? subscribe(sessionId, listener) : unsubscribeNothing),
    () => {
      if (!sessionId) return undefined
      const current = liveMessages.get(sessionId)
      return current?.id === messageId ? current : undefined
    },
  )
  return live && liveMessageIsAhead(live, message) ? live : message
}
