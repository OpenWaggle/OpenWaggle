import type { AgentLoopNotifyLevel } from '../types/agent-loop-interaction'

/**
 * Whether an agent notification leaves a durable record.
 *
 * Informational notices are ephemeral by contract: they appear in the notification stack and leave
 * no transcript history. Warnings and errors leave exactly one notice each.
 *
 * Shared because the same rule is applied twice, once when the main process decides what to persist
 * and once when the renderer projects events into transcript rows. Two copies of a durability rule
 * drift into a transcript that disagrees with itself after a reload, and neither side's unit tests
 * would notice, since each is individually consistent.
 */
export function notificationCreatesDurableRecord(level: AgentLoopNotifyLevel): boolean {
  return level !== 'info'
}

/**
 * Whether the resolution of a notification is worth keeping.
 *
 * Never. A notification cannot be answered, so its resolution is bookkeeping that OpenWaggle
 * synthesises for itself. Persisting it is what produced the original "Interaction resolved" cards
 * carrying nothing but `{"acknowledged": true}`.
 */
export function notificationResolutionCreatesDurableRecord(): boolean {
  return false
}
