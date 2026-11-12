import { isRecord } from './validation'

/**
 * How a queued Follow-up's caller recognises one that its direct steer became when the steered
 * Run stopped before incorporating it: that Run, and the steer's idempotency key. Empty for every
 * other Follow-up.
 */
export function returnedSteerProvenance(intent: unknown) {
  if (!isRecord(intent) || !isRecord(intent.returnedSteer)) return {}
  const { runId } = intent.returnedSteer
  const { idempotencyKey } = intent
  return typeof runId === 'string' && typeof idempotencyKey === 'string'
    ? { returnedSteer: { runId, idempotencyKey } }
    : {}
}
