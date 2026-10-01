/**
 * Follow-up edit hold lease policy (ADR 0043).
 *
 * A lease is counted in Host sweeps, not clock time: every sweep adds a missed sweep to each hold
 * and a renewal clears it, so a hold expires after `FOLLOW_UP_EDIT_HOLD_LEASE_SWEEPS` sweeps without
 * a renewal. The sweep is a timer in the Host process, which does not run while the machine sleeps
 * on any platform; clocks are not reliable for that (Windows' monotonic clock keeps counting across
 * sleep), so a long sleep cannot expire an open edit and deliver its old text.
 */

/** How often the Host advances leases and releases the expired ones. */
export const FOLLOW_UP_EDIT_HOLD_SWEEP_INTERVAL_MS = 5_000

/** How many sweeps a hold survives without a renewal. */
export const FOLLOW_UP_EDIT_HOLD_LEASE_SWEEPS = 6

/** The lease length a client can expect while the Host runs, for display and estimates only. */
export const FOLLOW_UP_EDIT_HOLD_LEASE_MS =
  FOLLOW_UP_EDIT_HOLD_LEASE_SWEEPS * FOLLOW_UP_EDIT_HOLD_SWEEP_INTERVAL_MS

/** How often the desktop main process renews the holds of its live windows (two sweeps). */
export const FOLLOW_UP_EDIT_HOLD_RENEW_INTERVAL_MS = 10_000

/**
 * How long attachments named by a Follow-up edit outlive their last reference, so a retried save or
 * a lost edit queued as a new message can still bind them. Measured on the Host's monotonic clock;
 * it is a convenience, so a platform whose clock counts across sleep only shortens it.
 */
export const FOLLOW_UP_EDIT_ATTACHMENT_RETENTION_MS = 60 * 60 * 1000

/** Wall-clock estimate of when a hold with `missedSweeps` runs out unless renewed. */
export function estimatedLeaseExpiry(missedSweeps: number, now: number) {
  return (
    now +
    Math.max(0, FOLLOW_UP_EDIT_HOLD_LEASE_SWEEPS - missedSweeps) *
      FOLLOW_UP_EDIT_HOLD_SWEEP_INTERVAL_MS
  )
}
