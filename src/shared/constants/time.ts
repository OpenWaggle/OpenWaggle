// Time unit constants and timeout/timing configuration.

/** Fundamental time unit constants — building blocks for derived values. */
export const TIME_UNIT = {
  MILLISECONDS_PER_SECOND: 1000,
  SECONDS_PER_MINUTE: 60,
  HOURS_PER_DAY: 24,
  /** Common durations in milliseconds — use these instead of raw numbers. */
  TWO_SECONDS_MS: 2 * 1000,
  FIVE_SECONDS_MS: 5 * 1000,
  TEN_SECONDS_MS: 10 * 1000,
  FIFTEEN_SECONDS_MS: 15 * 1000,
  THIRTY_SECONDS_MS: 30 * 1000,
  ONE_MINUTE_MS: 60 * 1000,
  TWO_MINUTES_MS: 2 * 60 * 1000,
  FIVE_MINUTES_MS: 5 * 60 * 1000,
  TEN_MINUTES_MS: 10 * 60 * 1000,
  FOUR_HOURS_MS: 4 * 60 * 60 * 1000,
} as const

/** Stream processing timeouts */
export const STREAM_TIMEOUT = {
  /** Max wait for stream chunks before declaring a stall */
  STALL_MS: TIME_UNIT.TWO_MINUTES_MS,
  /** Timeout while generating tool arguments */
  INCOMPLETE_TOOL_CALL_MS: TIME_UNIT.THIRTY_SECONDS_MS,
  /** Stream smoothing delay between chunks */
  SMOOTH_DELAY_MS: 10,
} as const

/** MCP server connection timeouts */
export const MCP_TIMEOUT = {
  /** MCP server connection timeout */
  CONNECT_MS: TIME_UNIT.THIRTY_SECONDS_MS,
  /** MCP tool execution timeout */
  TOOL_CALL_MS: TIME_UNIT.ONE_MINUTE_MS,
} as const

/** HTTP and external call timeouts */
export const HTTP_TIMEOUT = {
  /** Web fetch and project context fetch timeout */
  FETCH_MS: TIME_UNIT.THIRTY_SECONDS_MS,
  /** Provider connection test timeout */
  TEST_CONNECTION_MS: TIME_UNIT.FIFTEEN_SECONDS_MS,
} as const

/** Authentication timeouts */
export const AUTH_TIMEOUT = {
  /** Token refresh margin before expiry */
  REFRESH_MARGIN_MS: TIME_UNIT.FIVE_MINUTES_MS,
  /** OAuth callback wait timeout */
  OAUTH_CALLBACK_MS: TIME_UNIT.FIVE_MINUTES_MS,
  /** Polling frequency for clipboard auth codes */
  CLIPBOARD_POLL_INTERVAL_MS: 500,
  /** Total clipboard polling timeout */
  CLIPBOARD_POLL_TIMEOUT_MS: TIME_UNIT.FIVE_MINUTES_MS,
  /** Auth lifecycle check interval */
  LIFECYCLE_INTERVAL_MS: TIME_UNIT.TWO_MINUTES_MS,
} as const

/** Waggle collaboration timeouts */
export const WAGGLE_TIMEOUT = {
  /** Waggle turns may run orchestrate tools that take minutes */
  STALL_MS: TIME_UNIT.TEN_MINUTES_MS,
} as const

/** Voice model timeouts */
export const VOICE_TIMEOUT = {
  /** Voice model unload after idle */
  MODEL_IDLE_MS: TIME_UNIT.FIVE_MINUTES_MS,
} as const

/** Plan and tool management timeouts */
export const PLAN_TIMEOUT = {
  /** Plan proposal TTL before auto-rejection */
  PROPOSAL_TTL_MS: TIME_UNIT.TEN_MINUTES_MS,
} as const

/** Log file retention */
export const LOG_RETENTION = {
  /** Days to keep log files before cleanup */
  DAYS: 3,
} as const

/** Git status caching */
export const GIT_CACHE = {
  /** Git status cache TTL */
  STATUS_TTL_MS: TIME_UNIT.TWO_SECONDS_MS,
} as const

/** Auto-updater timing */
export const UPDATER_TIMING = {
  /** Delay before first update check after app start */
  INITIAL_CHECK_DELAY_MS: TIME_UNIT.FIVE_SECONDS_MS,
  /** Interval between update checks */
  CHECK_INTERVAL_MS: TIME_UNIT.FOUR_HOURS_MS,
} as const
