// Context window management, compaction thresholds, and health status configuration.

/** Default context window when a provider does not report one (128K tokens). */
export const CONTEXT_WINDOW = {
  /** Conservative default — most modern models support at least this */
  DEFAULT_TOKENS: 128_000,
} as const

/** Compaction thresholds and budgets */
export const COMPACTION = {
  /** Full compaction triggers when estimated tokens exceed this ratio of context window */
  THRESHOLD_RATIO: 0.9,
  /** Recent tool results preserved during Tier 1 microcompaction */
  MICRO_RECENT_TOOL_RESULTS: 5,
  /** Tighter tool result preservation for Waggle between-turn compaction */
  WAGGLE_MICRO_RECENT_TOOL_RESULTS: 3,
  /** Max token budget for recent user messages preserved after full compaction */
  FULL_USER_MESSAGE_BUDGET_TOKENS: 20_000,
} as const

/** Context health status thresholds (fraction of effective context used) */
export const CONTEXT_HEALTH = {
  /** Below this ratio: comfortable headroom */
  COMFORTABLE_THRESHOLD: 0.6,
  /** Below this ratio: getting tight */
  TIGHT_THRESHOLD: 0.8,
  /** Below this ratio: critical, compaction imminent */
  CRITICAL_THRESHOLD: 0.95,
} as const
