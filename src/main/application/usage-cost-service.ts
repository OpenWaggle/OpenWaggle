import type {
  UsageCostQuery,
  UsageCostSessionQuery,
  UsageCostSessionsResult,
  UsageCostView,
} from '@shared/types/usage-cost'
import {
  aggregateUsageCostView,
  rangeStartForPreset,
  selectUsageCostSessions,
} from '../domain/usage-cost/usage-cost-aggregate'
import type { UsageCostScanner } from '../ports/usage-cost'

/**
 * Usage & Cost application service (CONTEXT.md: Usage & Cost view). Scans
 * through the port, aggregates in the pure domain, and returns view DTOs.
 * Scanning happens on demand only: nothing here runs at startup or in the
 * background (the freshness contract lives in the view, not in a daemon).
 */
export interface UsageCostService {
  readonly getView: (query: UsageCostQuery) => Promise<UsageCostView>
  readonly getSessions: (query: UsageCostSessionQuery) => Promise<UsageCostSessionsResult>
}

export function createUsageCostService(scanner: UsageCostScanner): UsageCostService {
  const getView = async (query: UsageCostQuery): Promise<UsageCostView> => {
    const now = new Date()
    const collected = await scanner.collectSessions({
      rangeStartMs: rangeStartForPreset(query.preset, now),
    })
    return aggregateUsageCostView(collected, query, now)
  }

  const getSessions = async (query: UsageCostSessionQuery): Promise<UsageCostSessionsResult> => {
    const now = new Date()
    const collected = await scanner.collectSessions({
      rangeStartMs: rangeStartForPreset(query.preset, now),
    })
    const sessions = selectUsageCostSessions(collected, query, now)
    return { query, sessions, generatedAtMs: now.getTime() }
  }

  return { getView, getSessions }
}
