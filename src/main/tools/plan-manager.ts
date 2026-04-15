import { PLAN_TIMEOUT } from '@shared/constants/time'
import type { ConversationId } from '@shared/types/brand'
import type { PlanResponse } from '@shared/types/plan'

interface PendingPlanProposal {
  resolve: (response: PlanResponse) => void
  reject: (reason: Error) => void
}

/** Pending plan proposals keyed by conversationId (only one per conversation at a time) */
const pending = new Map<ConversationId, PendingPlanProposal>()

export function registerPlanProposal(
  conversationId: ConversationId,
  resolve: (response: PlanResponse) => void,
  reject: (reason: Error) => void,
): void {
  const existing = pending.get(conversationId)
  if (existing) {
    existing.reject(new Error('Superseded by a new plan proposal'))
  }
  pending.set(conversationId, { resolve, reject })
}

/**
 * Resolve a pending plan proposal. Returns `true` if an active run was
 * waiting for the response, `false` if no pending plan exists (e.g. the
 * plan was persisted by a checkpoint and the app restarted).
 */
export function respondToPlan(conversationId: ConversationId, response: PlanResponse): boolean {
  const entry = pending.get(conversationId)
  if (!entry) return false
  pending.delete(conversationId)
  entry.resolve(response)
  return true
}

export function cancelPlanProposal(conversationId: ConversationId): void {
  const entry = pending.get(conversationId)
  if (entry) {
    pending.delete(conversationId)
    entry.reject(new Error('Plan proposal cancelled'))
  }
}

/** Reject and remove all pending plan proposals. Used for clean shutdown. */
export function clearAllPlanProposals(): void {
  for (const [conversationId, entry] of pending) {
    pending.delete(conversationId)
    entry.reject(new Error('All plan proposals cleared'))
  }
}

/** Number of pending plan proposals. Exposed for testing/observability. */
export function pendingPlanCount(): number {
  return pending.size
}

/**
 * Register a plan proposal and wire abort signal + TTL cleanup.
 * Shared by both team-routed and renderer-routed plan flows.
 */
export function waitForPlanResponse(
  conversationId: ConversationId,
  signal?: AbortSignal,
): Promise<PlanResponse> {
  return new Promise<PlanResponse>((resolve, reject) => {
    const ttlTimer = setTimeout(() => {
      cancelPlanProposal(conversationId)
    }, PLAN_TIMEOUT.PROPOSAL_TTL_MS)

    const onAbort = (): void => {
      clearTimeout(ttlTimer)
      cancelPlanProposal(conversationId)
    }

    const wrappedResolve = (response: PlanResponse): void => {
      clearTimeout(ttlTimer)
      signal?.removeEventListener('abort', onAbort)
      resolve(response)
    }

    const wrappedReject = (reason: Error): void => {
      clearTimeout(ttlTimer)
      signal?.removeEventListener('abort', onAbort)
      reject(reason)
    }

    registerPlanProposal(conversationId, wrappedResolve, wrappedReject)

    if (signal?.aborted) {
      clearTimeout(ttlTimer)
      cancelPlanProposal(conversationId)
      reject(new Error('Plan proposal cancelled'))
      return
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
