import type { AggregateUsageCostViewInput, UsageCostScanStats } from '../domain/usage-cost/usage-cost-aggregate'

/**
 * Port for the Usage & Cost view. Implementations scan Pi session records on
 * this machine and return them for pure aggregation in the domain layer.
 */
export interface UsageCostScanner {
  readonly collectSessions: (input: {
    /** Inclusive lower record-time bound; `null` scans every file. */
    readonly rangeStartMs: number | null
  }) => Promise<{
    readonly sessions: AggregateUsageCostViewInput['sessions']
    readonly stats: UsageCostScanStats
  }>
}
