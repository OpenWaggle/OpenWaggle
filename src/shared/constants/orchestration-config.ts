// Orchestration streaming and context configuration.

/** Stream chunk delivery settings */
export const STREAM_DELIVERY = {
  /** Default chunk size for orchestration streaming */
  CHUNK_SIZE: 50,
  /** Delay between chunks in ms */
  CHUNK_DELAY_MS: 12,
} as const

/** Context budget for orchestration */
export const CONTEXT_BUDGET = {
  /** Default max context tokens for task heuristic */
  MAX_TOKENS: 1500,
} as const

/** Anthropic provider output tokens */
export const ANTHROPIC_OUTPUT = {
  /** Minimum output tokens reserved beyond thinking budget */
  MIN_TOKENS: 1024,
} as const
