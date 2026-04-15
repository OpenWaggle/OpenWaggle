// Timeout durations for stream processing, connections, and external calls.

import { FIVE_MINUTES_IN_MILLISECONDS } from './constants'

/** Stream processing timeouts */
export const STREAM_TIMEOUT = {
  /** Max wait for stream chunks before declaring a stall (2 minutes) */
  STALL_MS: 120_000,
  /** Timeout while generating tool arguments (30 seconds) */
  INCOMPLETE_TOOL_CALL_MS: 30_000,
  /** Stream smoothing delay between chunks */
  SMOOTH_DELAY_MS: 10,
} as const

/** MCP server connection timeouts */
export const MCP_TIMEOUT = {
  /** MCP server connection timeout (30 seconds) */
  CONNECT_MS: 30_000,
  /** MCP tool execution timeout (60 seconds) */
  TOOL_CALL_MS: 60_000,
} as const

/** HTTP and external call timeouts */
export const HTTP_TIMEOUT = {
  /** Web fetch and project context fetch timeout (30 seconds) */
  FETCH_MS: 30_000,
  /** Provider connection test timeout (15 seconds) */
  TEST_CONNECTION_MS: 15_000,
} as const

/** Authentication timeouts */
export const AUTH_TIMEOUT = {
  /** Token refresh margin before expiry (5 minutes) */
  REFRESH_MARGIN_MS: FIVE_MINUTES_IN_MILLISECONDS,
  /** OAuth callback wait timeout (5 minutes) */
  OAUTH_CALLBACK_MS: FIVE_MINUTES_IN_MILLISECONDS,
  /** Polling frequency for clipboard auth codes */
  CLIPBOARD_POLL_INTERVAL_MS: 500,
  /** Total clipboard polling timeout (5 minutes) */
  CLIPBOARD_POLL_TIMEOUT_MS: FIVE_MINUTES_IN_MILLISECONDS,
  /** Auth lifecycle check interval (2 minutes) */
  LIFECYCLE_INTERVAL_MS: 2 * 60 * 1000,
} as const

/** Waggle collaboration timeouts */
export const WAGGLE_TIMEOUT = {
  /** Waggle turns may run orchestrate tools that take minutes (10 minutes) */
  STALL_MS: 600_000,
} as const

/** Voice model timeouts */
export const VOICE_TIMEOUT = {
  /** Voice model unload after idle (5 minutes) */
  MODEL_IDLE_MS: 300_000,
} as const

/** Plan and tool management timeouts */
export const PLAN_TIMEOUT = {
  /** Plan proposal TTL before auto-rejection (10 minutes) */
  PROPOSAL_TTL_MS: 10 * 60 * 1000,
} as const

/** Log file retention */
export const LOG_RETENTION = {
  /** Days to keep log files before cleanup */
  DAYS: 3,
} as const

/** Git status caching */
export const GIT_CACHE = {
  /** Git status cache TTL (2 seconds) */
  STATUS_TTL_MS: 2000,
} as const

/** Auto-updater timing */
export const UPDATER_TIMING = {
  /** Delay before first update check after app start */
  INITIAL_CHECK_DELAY_MS: 5_000,
  /** Interval between update checks (4 hours) */
  CHECK_INTERVAL_MS: 4 * 60 * 60 * 1_000,
} as const
