import { BASE_TEN, MILLISECONDS_PER_SECOND, SECONDS_PER_MINUTE } from '@shared/constants/constants'
import type { ConversationId } from '@shared/types/brand'
import type { PlanResponse } from '@shared/types/plan'

/** Maximum time a plan proposal can remain pending before auto-rejection (10 minutes) */
const PLAN_PROPOSAL_TTL_MS = BASE_TEN * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND

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

export function respondToPlan(conversationId: ConversationId, response: PlanResponse): void {
  const entry = pending.get(conversationId)
  if (!entry) {
    // Plan was cancelled (e.g. via steer or abort) — silently ignore
    return
  }
  pending.delete(conversationId)
  entry.resolve(response)
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
    }, PLAN_PROPOSAL_TTL_MS)

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

/** Exposed for testing */
export { PLAN_PROPOSAL_TTL_MS }
