import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import { api } from '@/shared/lib/ipc'

/**
 * Per-Session model switches.
 *
 * The Session Host stores the model in the Session's execution profile and every Run reads it when
 * the Run starts. The renderer therefore only has to (1) show the pick at once, (2) make the durable
 * write land before anything that starts a Run, and (3) converge on what the Host actually stored.
 *
 * Writes for one Session are serialized so they land in pick order. While a write is pending, the
 * newest pick is laid over any Session detail that arrives, because a detail read before the write
 * committed would otherwise put the previous model back on screen and on the next send.
 */
interface SessionModelWriteState {
  /** The newest model the user picked whose write has not settled yet. */
  readonly pending: Map<SessionId, SupportedModelId>
  /** The model the Host is known to hold, used to roll a failed newest pick back. */
  readonly committed: Map<SessionId, SupportedModelId>
  readonly chains: Map<SessionId, Promise<void>>
}

const writes: SessionModelWriteState = {
  pending: new Map(),
  committed: new Map(),
  chains: new Map(),
}

/** Lays a pending pick over an incoming Session detail so a stale read cannot undo it. */
export function withPendingSessionModel(session: SessionDetail): SessionDetail {
  const pending = writes.pending.get(session.id)
  return pending && session.executionModel !== pending
    ? { ...session, executionModel: pending }
    : session
}

/** Resolves once every model write already requested for the Session has settled. */
export function settledSessionModelWrites(sessionId: SessionId): Promise<void> {
  return writes.chains.get(sessionId) ?? Promise.resolve()
}

interface SessionModelWriteInput {
  readonly sessionId: SessionId
  readonly model: SupportedModelId
  readonly previousModel: SupportedModelId | undefined
  /** Applies a model to the cached Session detail without a Host round trip. */
  readonly applyModel: (model: SupportedModelId) => void
  /** Re-reads the Session so the cache converges on the stored value. */
  readonly refresh: () => Promise<void>
  readonly onError: (error: unknown) => void
}

export function writeSessionModel(input: SessionModelWriteInput): Promise<void> {
  const { sessionId, model } = input
  if (!writes.pending.has(sessionId) && input.previousModel !== undefined) {
    writes.committed.set(sessionId, input.previousModel)
  }
  writes.pending.set(sessionId, model)
  input.applyModel(model)

  const previousChain = settledSessionModelWrites(sessionId)
  const chain = previousChain
    .then(() => api.setSessionModel(sessionId, model))
    .then(
      () => {
        writes.committed.set(sessionId, model)
        if (writes.pending.get(sessionId) !== model) return
        writes.pending.delete(sessionId)
        return input.refresh()
      },
      (error: unknown) => {
        if (writes.pending.get(sessionId) !== model) return
        writes.pending.delete(sessionId)
        const committed = writes.committed.get(sessionId)
        if (committed) input.applyModel(committed)
        input.onError(error)
        return input.refresh()
      },
    )
    .catch(() => undefined)
    .finally(() => {
      if (writes.chains.get(sessionId) === chain) writes.chains.delete(sessionId)
    })
  writes.chains.set(sessionId, chain)
  return chain
}

export function resetSessionModelWritesForTests() {
  writes.pending.clear()
  writes.committed.clear()
  writes.chains.clear()
}
