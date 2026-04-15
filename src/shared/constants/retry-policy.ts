// Retry counts, delays, and backoff strategies.

/** Agent stream stall retry policy */
export const STALL_RETRY = {
  MAX_RETRIES: 2,
  DELAY_MS: 2_000,
} as const

/** LLM provider error retry policy */
export const PROVIDER_RETRY = {
  MAX_RETRIES: 2,
  BASE_DELAY_MS: 1_000,
  BACKOFF_BASE: 2,
} as const

/** MCP server reconnection policy */
export const MCP_RECONNECT = {
  MAX_RETRIES: 5,
  BASE_MS: 1_000,
  MAX_MS: 30_000,
} as const

/** Orchestration task retry policy */
export const ORCHESTRATION_RETRY = {
  BACKOFF_MS: 500,
  JITTER_MS: 200,
} as const
