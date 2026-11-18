/**
 * The request keys of the cancels the Host sends to release a Follow-up edit hold: when the hold
 * expires, and when the window holding it closes, crashes, reloads or navigates away. The cancel
 * is journaled under the holder, the person, but the Host sends it: what it delivers is not a Run
 * the person's own queue action started (ADR 0030, amended 2026-11-09).
 */
const EXPIRED_HOLD_KEY_PREFIX = 'follow-up-edit-hold-expired:'
const CLOSED_WINDOW_HOLD_KEY_PREFIX = 'follow-up-edit-window-closed:'

export function expiredFollowUpEditHoldKey(holdId: string) {
  return `${EXPIRED_HOLD_KEY_PREFIX}${holdId}`
}

export function closedWindowFollowUpEditHoldKey(holdId: string) {
  return `${CLOSED_WINDOW_HOLD_KEY_PREFIX}${holdId}`
}

export function isHostFollowUpEditHoldReleaseKey(idempotencyKey: string) {
  return (
    idempotencyKey.startsWith(EXPIRED_HOLD_KEY_PREFIX) ||
    idempotencyKey.startsWith(CLOSED_WINDOW_HOLD_KEY_PREFIX)
  )
}
