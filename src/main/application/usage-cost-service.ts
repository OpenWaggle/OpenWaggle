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
  type UsageCostDisplayContext,
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

/**
 * Display and project-resolution context composed from settings in the IPC
 * handler. `knownProjects` attributes sessions to the project their cwd sits
 * inside when the cwd is not itself a worktree with a git pointer.
 */
export interface UsageCostServiceContext extends UsageCostDisplayContext {
  readonly knownProjects: readonly string[]
}

export function createUsageCostService(
  scanner: UsageCostScanner,
  context: UsageCostServiceContext,
): UsageCostService {
  const getView = async (query: UsageCostQuery): Promise<UsageCostView> => {
    const now = new Date()
    const collected = await scanner.collectSessions({
      rangeStartMs: rangeStartForPreset(query.preset, now),
      knownProjects: context.knownProjects,
    })
    return aggregateUsageCostView({ ...collected, display: context }, query, now)
  }

  const getSessions = async (query: UsageCostSessionQuery): Promise<UsageCostSessionsResult> => {
    const now = new Date()
    const collected = await scanner.collectSessions({
      rangeStartMs: rangeStartForPreset(query.preset, now),
      knownProjects: context.knownProjects,
    })
    const sessions = selectUsageCostSessions({ ...collected, display: context }, query, now)
    return { query, sessions, generatedAtMs: now.getTime() }
  }

  return { getView, getSessions }
}
