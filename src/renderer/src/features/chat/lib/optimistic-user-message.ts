import type { UIMessage } from '@shared/types/chat-ui'

/**
 * A composer send the transcript is waiting to hold near the top (ADR 0036). The latest user
 * message when the send began tells its optimistic row apart from earlier ones, which can keep
 * optimistic ids.
 */
export interface PendingSend {
  readonly afterUserMessageId: string | null
}

/** The id prefix of the renderer's optimistic copy of a composer send. */
export const OPTIMISTIC_USER_MESSAGE_ID_PREFIX = 'optimistic-user-'

/**
 * Whether a user message has an optimistic id. Reconciliation keeps that id after the message is
 * persisted, for stable row identity, so this alone does not mean "not yet persisted".
 */
export function isOptimisticUserMessageId(id: string) {
  return id.startsWith(OPTIMISTIC_USER_MESSAGE_ID_PREFIX)
}

/**
 * The row key of a pending send's own optimistic message, once it is the latest user message: an
 * optimistic id newer than the latest user message when the send began. `null` until then.
 */
export function pendingSentRowKey(
  pendingSend: PendingSend | null,
  lastUserMessageId: string | null,
) {
  if (pendingSend === null || lastUserMessageId === null) return null
  if (lastUserMessageId === pendingSend.afterUserMessageId) return null
  return isOptimisticUserMessageId(lastUserMessageId) ? `message:${lastUserMessageId}` : null
}

/**
 * A composer send begun now: it holds the first optimistic message after the latest user message.
 *
 * The baseline comes from the live message list while the transcript compares it with its own
 * latest user message. They agree at the branch head, where the transcript's tail is the live list,
 * and elsewhere transcript rows carry durable ids, which are never optimistic: a mismatch leaves
 * the send pending rather than holding the wrong row.
 */
export function pendingSendAfter(messages: readonly UIMessage[]): PendingSend {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user') return { afterUserMessageId: message.id }
  }
  return { afterUserMessageId: null }
}
