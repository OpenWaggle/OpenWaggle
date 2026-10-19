import type { SessionId } from '@shared/types/brand'

const copying = new Set<string>()

/**
 * Runs one fork or clone of a Session at a time. Each request makes a new Session, and the Host
 * takes a while to write the copy, so a second click while the first is on its way made a second
 * copy. A request made meanwhile is dropped and reported by `false`.
 */
export async function runSessionCopyOnce(
  sessionId: SessionId,
  copy: () => Promise<void>,
): Promise<boolean> {
  const key = String(sessionId)
  if (copying.has(key)) return false
  copying.add(key)
  try {
    await copy()
    return true
  } finally {
    copying.delete(key)
  }
}
