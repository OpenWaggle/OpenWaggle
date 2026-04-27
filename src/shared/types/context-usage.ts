export interface ContextUsageSnapshot {
  /** Estimated context tokens, or null when Pi marks usage unknown after compaction. */
  readonly tokens: number | null
  readonly contextWindow: number
  /** Percentage of context window used, or null when token usage is unknown. */
  readonly percent: number | null
}

export interface ContextCompactionResult {
  readonly summary: string
  readonly firstKeptEntryId: string
  readonly tokensBefore: number
}
