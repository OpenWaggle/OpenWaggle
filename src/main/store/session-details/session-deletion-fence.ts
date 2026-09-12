import type { SessionId } from '@shared/types/brand'

const deleting = new Set<SessionId>()
const mutations = new Map<SessionId, Set<Promise<void>>>()

/** Close admission first, then drain admitted writes before checking deletion eligibility. */
export async function acquireSessionDeletionFence(id: SessionId): Promise<() => void> {
  if (deleting.has(id)) throw new Error('Session deletion is already in progress.')
  deleting.add(id)
  await Promise.all(mutations.get(id) ?? [])
  let released = false
  return () => {
    if (released) return
    released = true
    deleting.delete(id)
  }
}

/** Reject instead of waiting: cancelled run finalizers must never wait on their own deletion. */
export async function withSessionLineageMutation<A>(
  sessionIds: readonly SessionId[],
  operation: () => Promise<A>,
): Promise<A> {
  const ids = [...new Set(sessionIds)].sort()
  for (const id of ids) {
    if (deleting.has(id))
      throw new Error('Session deletion is in progress; Hive changes are blocked.')
  }
  const settled = Promise.withResolvers<void>()
  for (const id of ids) {
    const pending = mutations.get(id) ?? new Set<Promise<void>>()
    pending.add(settled.promise)
    mutations.set(id, pending)
  }
  try {
    return await operation()
  } finally {
    for (const id of ids) {
      const pending = mutations.get(id)
      pending?.delete(settled.promise)
      if (pending?.size === 0) mutations.delete(id)
    }
    settled.resolve()
  }
}
