import type { SessionId } from '@shared/types/brand'

const copying = new Set<string>()

/**
 * Runs one fork or clone of a Session at a time, from finding its source node to opening the copy.
 * Each request makes a new Session and the Host takes a while to write it, so a second click while
 * the first is on its way made a second copy. A request made meanwhile is dropped: the copy on its
 * way is the one the user asked for.
 */
export async function runSessionCopyOnce(
  sessionId: SessionId,
  copy: () => Promise<void>,
): Promise<void> {
  const key = String(sessionId)
  if (copying.has(key)) return
  copying.add(key)
  try {
    await copy()
  } finally {
    copying.delete(key)
  }
}
