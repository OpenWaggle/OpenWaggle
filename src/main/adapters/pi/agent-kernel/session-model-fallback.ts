import type { SessionDetail } from '@shared/types/session'

/**
 * The real model that answered the Session last. A Session whose selected model no longer
 * resolves, such as a virtual model whose extension was removed, continues on it, as Pi does when
 * it resumes such a session.
 */
export function sessionFallbackModelReference(session: SessionDetail) {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index]
    if (message?.role === 'assistant' && message.model) {
      return { fallbackModelReference: String(message.model) }
    }
  }
  return {}
}
