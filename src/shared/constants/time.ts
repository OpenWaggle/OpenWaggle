// Time unit constants and timeout/timing configuration.

// Base units — used to derive all values in TIME_UNIT without repetition.
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const HOURS_PER_DAY = 24

/** Fundamental time unit constants — building blocks for derived values. */
export const TIME_UNIT = {
  MILLISECONDS_PER_SECOND: MS_PER_SECOND,
  SECONDS_PER_MINUTE: SECONDS_PER_MINUTE,
  HOURS_PER_DAY: HOURS_PER_DAY,
  /** Common durations in milliseconds — use these instead of raw numbers. */
  TWO_SECONDS_MS: 2 * MS_PER_SECOND,
  FIVE_SECONDS_MS: 5 * MS_PER_SECOND,
  TEN_SECONDS_MS: 10 * MS_PER_SECOND,
  FIFTEEN_SECONDS_MS: 15 * MS_PER_SECOND,
  THIRTY_SECONDS_MS: 30 * MS_PER_SECOND,
  ONE_MINUTE_MS: SECONDS_PER_MINUTE * MS_PER_SECOND,
  TWO_MINUTES_MS: 2 * SECONDS_PER_MINUTE * MS_PER_SECOND,
  FIVE_MINUTES_MS: 5 * SECONDS_PER_MINUTE * MS_PER_SECOND,
  TEN_MINUTES_MS: 10 * SECONDS_PER_MINUTE * MS_PER_SECOND,
  FOUR_HOURS_MS: 4 * SECONDS_PER_MINUTE * SECONDS_PER_MINUTE * MS_PER_SECOND,
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

/** Voice model timeouts */
export const VOICE_TIMEOUT = {
  /** Voice model unload after idle */
  MODEL_IDLE_MS: TIME_UNIT.FIVE_MINUTES_MS,
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
