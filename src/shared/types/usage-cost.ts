import type { SchemaType } from '@shared/schema'
import type {
  usageCostBucketSchema,
  usageCostDaySchema,
  usageCostModelRowSchema,
  usageCostProjectRowSchema,
  usageCostQuerySchema,
  usageCostSessionOriginSchema,
  usageCostSessionQuerySchema,
  usageCostSessionRowSchema,
  usageCostSessionsResultSchema,
  usageCostViewSchema,
} from '@shared/schemas/usage-cost'

/**
 * Usage & Cost view contracts (CONTEXT.md: Usage & Cost view).
 *
 * The view aggregates token counts and costs from Pi's own session records on
 * this machine. It is local-only data: nothing here is reported anywhere and it
 * shares nothing with Usage statistics.
 */

export const USAGE_COST_RANGE_PRESETS = ['7d', '30d', '90d', 'all'] as const

export const USAGE_COST_ORIGIN_FILTERS = ['all', 'openwaggle', 'other-pi-clients'] as const

/** Which Pi client started a session (ADR 0052: recognized from OpenWaggle's own session entries, never inferred). */
export const USAGE_COST_SESSION_ORIGINS = ['openwaggle', 'other-pi-clients'] as const
export type UsageCostSessionOrigin = SchemaType<typeof usageCostSessionOriginSchema>

export type UsageCostQuery = SchemaType<typeof usageCostQuerySchema>
export type UsageCostSessionQuery = SchemaType<typeof usageCostSessionQuerySchema>
export type UsageCostBucket = SchemaType<typeof usageCostBucketSchema>
export type UsageCostDay = SchemaType<typeof usageCostDaySchema>
export type UsageCostModelRow = SchemaType<typeof usageCostModelRowSchema>
export type UsageCostProjectRow = SchemaType<typeof usageCostProjectRowSchema>
export type UsageCostSessionRow = SchemaType<typeof usageCostSessionRowSchema>
export type UsageCostView = SchemaType<typeof usageCostViewSchema>
export type UsageCostSessionsResult = SchemaType<typeof usageCostSessionsResultSchema>
