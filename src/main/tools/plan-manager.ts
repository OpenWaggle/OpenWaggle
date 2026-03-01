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
