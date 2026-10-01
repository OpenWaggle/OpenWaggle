/**
 * Follow-up edit hold lease policy (ADR 0043). Lease times are on the Host's monotonic clock, which
 * does not advance while the machine sleeps, so a long sleep cannot expire an open edit.
 */

/** How long a hold lives without a renewal. */
export const FOLLOW_UP_EDIT_HOLD_LEASE_MS = 30_000

/** How often the desktop main process renews the holds of its live windows. */
export const FOLLOW_UP_EDIT_HOLD_RENEW_INTERVAL_MS = 10_000

/** How often the Host looks for holds whose lease ran out. */
export const FOLLOW_UP_EDIT_HOLD_SWEEP_INTERVAL_MS = 5_000

/**
 * How long attachments named by a Follow-up edit outlive their last reference, so a retried save or
 * a lost edit queued as a new message can still bind them.
 */
export const FOLLOW_UP_EDIT_ATTACHMENT_RETENTION_MS = 60 * 60 * 1000
