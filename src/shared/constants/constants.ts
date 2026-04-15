// Re-export facade — constants have moved to domain-specific modules.
// Prefer importing from the canonical module directly.
//
// Canonical homes:
//   math.ts          → DOUBLE_FACTOR, TRIPLE_FACTOR, BASE_TEN, HEX_RADIX, PERCENT_BASE
//   resource-limits.ts → BYTES_PER_KIBIBYTE
//   time.ts           → TIME_UNIT (MILLISECONDS_PER_SECOND, SECONDS_PER_MINUTE, etc.)
//   http-status.ts    → HTTP_BAD_REQUEST, HTTP_UNAUTHORIZED

export { HTTP_BAD_REQUEST, HTTP_UNAUTHORIZED } from './http-status'
export { BASE_TEN, DOUBLE_FACTOR, HEX_RADIX, PERCENT_BASE, TRIPLE_FACTOR } from './math'
export { BYTES_PER_KIBIBYTE } from './resource-limits'
export { TIME_UNIT } from './time'

// Legacy named re-exports for backward compatibility during migration.
// TODO: update consumers to import TIME_UNIT.* from time.ts directly.
export const MILLISECONDS_PER_SECOND = 1000
export const SECONDS_PER_MINUTE = 60
export const HOURS_PER_DAY = 24
export const FIVE_MINUTES_IN_MILLISECONDS = 5 * 60 * 1000
