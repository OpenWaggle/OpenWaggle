import { uncheckedFields } from './object-shape'

interface FollowUpIntentFields {
  readonly returnedSteer: { readonly runId: string }
  readonly idempotencyKey: string
}

/**
 * How a queued Follow-up's caller recognises one that its direct steer became when the steered
 * Run stopped before incorporating it: that Run, and the steer's idempotency key. Empty for every
 * other Follow-up.
 */
export function returnedSteerProvenance(intent: unknown) {
  const { returnedSteer, idempotencyKey } = uncheckedFields<FollowUpIntentFields>(intent)
  const { runId } = uncheckedFields<FollowUpIntentFields['returnedSteer']>(returnedSteer)
  return typeof runId === 'string' && typeof idempotencyKey === 'string'
    ? { returnedSteer: { runId, idempotencyKey } }
    : {}
}
