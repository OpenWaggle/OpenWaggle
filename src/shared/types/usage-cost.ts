/**
 * Usage & Cost view contracts (CONTEXT.md: Usage & Cost view).
 *
 * The view aggregates token counts and costs from Pi's own session records on
 * this machine. It is local-only data: nothing here is reported anywhere and it
 * shares nothing with Usage statistics.
 */

export const USAGE_COST_RANGE_PRESETS = ['7d', '30d', '90d', 'all'] as const
export type UsageCostRangePreset = (typeof USAGE_COST_RANGE_PRESETS)[number]

export const USAGE_COST_ORIGIN_FILTERS = ['all', 'openwaggle', 'other-pi-clients'] as const
export type UsageCostOriginFilter = (typeof USAGE_COST_ORIGIN_FILTERS)[number]

/** Which Pi client started a session (ADR 0052: recognized from OpenWaggle's own session entries, never inferred). */
export const USAGE_COST_SESSION_ORIGINS = ['openwaggle', 'other-pi-clients'] as const
export type UsageCostSessionOrigin = (typeof USAGE_COST_SESSION_ORIGINS)[number]

/** How a cost number was obtained (CONTEXT.md: Cost tier). */
export const USAGE_COST_TIERS = ['recorded', 'estimated', 'unpriced'] as const
export type UsageCostTier = (typeof USAGE_COST_TIERS)[number]

export interface UsageCostQuery {
  readonly preset: UsageCostRangePreset
  readonly origin: UsageCostOriginFilter
}

export interface UsageCostSessionQuery extends UsageCostQuery {
  /** Local-timezone day bucket, `YYYY-MM-DD`, from a drill-down selection. */
  readonly day?: string
  readonly provider?: string
  readonly modelId?: string
  /** Resolved project path group key; `null` selects sessions recorded without a working directory. */
  readonly projectPath?: string | null
}

export interface UsageCostTokens {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly total: number
}

/**
 * Cost aggregates for a bucket. `recordedCostUsd` and `estimatedCostUsd` are
 * disjoint sums by Cost tier; `unpricedTokens` counts tokens in records that
 * have neither. Total cost is `recordedCostUsd + estimatedCostUsd`.
 */
export interface UsageCostBucket {
  readonly tokens: UsageCostTokens
  readonly recordedCostUsd: number
  readonly estimatedCostUsd: number
  readonly unpricedTokens: number
}

export interface UsageCostDay extends UsageCostBucket {
  /** Local-timezone day, `YYYY-MM-DD`. */
  readonly day: string
}

export interface UsageCostModelRow extends UsageCostBucket {
  readonly provider: string
  readonly modelId: string
}

export interface UsageCostProjectRow extends UsageCostBucket {
  /** Owning project path a worktree or subdirectory resolved to, else the raw cwd, or `null`. Drill-down key. */
  readonly projectPath: string | null
  /** Display label: project display name, project leaf name, 'Temporary directory', or 'Unknown location'. */
  readonly label: string
  /** Home-abbreviated display path (`~/…`), or `null` when there is no path to show. Never a raw absolute path. */
  readonly detail: string | null
}

export interface UsageCostSessionRow extends UsageCostBucket {
  readonly sessionId: string | null
  /** The Pi session's latest `/name`, else its first prompt, shortened; `null` when it has neither. */
  readonly title: string | null
  /** Absolute session file path; the drill-down key. */
  readonly file: string
  /** Display label of the session's owning project, or `null`. */
  readonly projectLabel: string | null
  /** Home-abbreviated display path for the session cwd (`~/…`), or `null`. Never a raw absolute path. */
  readonly displayCwd: string | null
  readonly origin: UsageCostSessionOrigin
  readonly startedAtMs: number | null
  readonly lastActivityMs: number | null
}

export interface UsageCostView {
  readonly query: UsageCostQuery
  readonly generatedAtMs: number
  readonly rangeStartMs: number | null
  readonly rangeEndMs: number
  readonly totals: UsageCostBucket
  /** `unpricedTokens / tokens.total`, 0 when nothing was scanned. */
  readonly unpricedShare: number
  readonly days: readonly UsageCostDay[]
  readonly models: readonly UsageCostModelRow[]
  readonly projects: readonly UsageCostProjectRow[]
  readonly sessionCount: number
  readonly scannedFiles: number
  readonly scannedFilesCached: number
  readonly scanDurationMs: number
}

export interface UsageCostSessionsResult {
  readonly query: UsageCostSessionQuery
  readonly sessions: readonly UsageCostSessionRow[]
  readonly generatedAtMs: number
}
