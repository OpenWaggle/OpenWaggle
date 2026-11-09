/**
 * The request key of the cancel the Host sends when a Follow-up edit hold expires. The cancel is
 * journaled under the holder, the person, but the Host sends it: what it delivers is not a Run the
 * person's own queue action started (ADR 0030, amended 2026-11-09).
 */
const EXPIRED_HOLD_KEY_PREFIX = 'follow-up-edit-hold-expired:'

export function expiredFollowUpEditHoldKey(holdId: string) {
  return `${EXPIRED_HOLD_KEY_PREFIX}${holdId}`
}

export function isExpiredFollowUpEditHoldKey(idempotencyKey: string) {
  return idempotencyKey.startsWith(EXPIRED_HOLD_KEY_PREFIX)
}
