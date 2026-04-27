import type { SessionId } from '@shared/types/brand'

/**
 * Simple promise-chain mutex keyed by SessionId.
 * Serializes writes to the same projected session to prevent concurrent
 * read-modify-write races.
 */
const locks = new Map<SessionId, Promise<void>>()

export async function withSessionLock<T>(id: SessionId, fn: () => Promise<T>): Promise<T> {
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
    if (locks.get(id) === next) {
      locks.delete(id)
    }
  }
}
