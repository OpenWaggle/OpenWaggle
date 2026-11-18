import type { SessionId } from '@shared/types/brand'

/**
 * The prefix a discovered Pi session's node ids carry in front of its Pi entry ids (ADR 0051).
 * Unique per Session, so entry ids a `pi` CLI fork copied from another session never collide on
 * the global node key (ADR 0041), and the Pi file is never rewritten.
 */
export function discoveredPiEntryNodeIdPrefix(sessionId: SessionId | string) {
  return `${sessionId}/`
}
