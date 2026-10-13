/** Token and cost totals of one model, or of usage no model is named on (`model: null`). */
export interface SessionModelUsage {
  readonly model: string | null
  readonly tokens: number
  /** US dollars, as the provider prices it. */
  readonly cost: number
}

/** A Session's usage so far, like Pi's `/session`: totals and the share of each physical model. */
export interface SessionUsageSummary {
  readonly tokens: number
  readonly cost: number
  readonly models: readonly SessionModelUsage[]
}

export interface ContextUsageSnapshot {
  /** Estimated context tokens, or null when Pi marks usage unknown after compaction. */
  readonly tokens: number | null
  readonly contextWindow: number
  /** Percentage of context window used, or null when token usage is unknown. */
  readonly percent: number | null
  /** The Session's token and cost totals, when it has any. */
  readonly session?: SessionUsageSummary
}

export interface ContextCompactionResult {
  readonly summary: string
  readonly firstKeptEntryId: string
  readonly tokensBefore: number
}
