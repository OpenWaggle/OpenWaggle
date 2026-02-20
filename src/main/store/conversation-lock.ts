import type { ConversationId } from '@shared/types/brand'

/**
 * Simple promise-chain mutex keyed by ConversationId.
 * Serializes writes to the same conversation to prevent
 * concurrent read-modify-write races.
 */
const locks = new Map<ConversationId, Promise<void>>()

export async function withConversationLock<T>(
  id: ConversationId,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve()

  let resolve: (() => void) | undefined
  const next = new Promise<void>((r) => {
    resolve = r
  })
  locks.set(id, next)

  try {
    await previous
    return await fn()
  } finally {
    resolve?.()
    // Auto-clean: if this is still the tail of the chain, remove it
    if (locks.get(id) === next) {
      locks.delete(id)
    }
  }
}
