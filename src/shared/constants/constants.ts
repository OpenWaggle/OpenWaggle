// Shared numeric constants used across main, renderer, and shared modules.
//
// Byte-unit constants → canonical home: resource-limits.ts
// Time-unit constants → canonical home: timeouts.ts
// Re-exported here for backward compatibility during migration.

export { BYTES_PER_KIBIBYTE } from './resource-limits'
export { HOURS_PER_DAY, MILLISECONDS_PER_SECOND, SECONDS_PER_MINUTE } from './timeouts'

export const DOUBLE_FACTOR = 2
export const TRIPLE_FACTOR = 3

export const BASE_TEN = 10
export const HEX_RADIX = 16
export const PERCENT_BASE = 100

export const FIVE_MINUTES_IN_MILLISECONDS = 5 * 60 * 1000

export const HTTP_BAD_REQUEST = 400
export const HTTP_UNAUTHORIZED = 401
