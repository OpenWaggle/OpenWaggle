import { Schema } from '@shared/schema'
import {
  USAGE_COST_ORIGIN_FILTERS,
  USAGE_COST_RANGE_PRESETS,
  USAGE_COST_SESSION_ORIGINS,
} from '@shared/types/usage-cost'

/** The single source of the Usage & Cost view types in `@shared/types/usage-cost`. */

export const usageCostRangePresetSchema = Schema.Literal(...USAGE_COST_RANGE_PRESETS)
export const usageCostOriginFilterSchema = Schema.Literal(...USAGE_COST_ORIGIN_FILTERS)
/** Which Pi client started a session (ADR 0052: recognized from OpenWaggle's own session entries, never inferred). */
export const usageCostSessionOriginSchema = Schema.Literal(...USAGE_COST_SESSION_ORIGINS)

export const usageCostQuerySchema = Schema.Struct({
  preset: usageCostRangePresetSchema,
  origin: usageCostOriginFilterSchema,
})

export const usageCostSessionQuerySchema = Schema.Struct({
  ...usageCostQuerySchema.fields,
  /** Local-timezone day bucket, `YYYY-MM-DD`, from a drill-down selection. */
  day: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  modelId: Schema.optional(Schema.String),
  /** Resolved project path group key; `null` selects sessions recorded without a working directory. */
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
})

export const usageCostTokensSchema = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  total: Schema.Number,
})

/**
 * Cost aggregates for a bucket. `recordedCostUsd` and `estimatedCostUsd` are
 * disjoint sums by Cost tier; `unpricedTokens` counts tokens in records that
 * have neither. Total cost is `recordedCostUsd + estimatedCostUsd`.
 */
const usageCostBucketFields = {
  tokens: usageCostTokensSchema,
  recordedCostUsd: Schema.Number,
  estimatedCostUsd: Schema.Number,
  unpricedTokens: Schema.Number,
}

export const usageCostBucketSchema = Schema.Struct(usageCostBucketFields)

export const usageCostDaySchema = Schema.Struct({
  ...usageCostBucketFields,
  /** Local-timezone day, `YYYY-MM-DD`. */
  day: Schema.String,
})

export const usageCostModelRowSchema = Schema.Struct({
  ...usageCostBucketFields,
  provider: Schema.String,
  modelId: Schema.String,
})

export const usageCostProjectRowSchema = Schema.Struct({
  ...usageCostBucketFields,
  /** Owning project path a worktree or subdirectory resolved to, else the raw cwd, or `null`. Drill-down key. */
  projectPath: Schema.NullOr(Schema.String),
  /** Display label: project display name, project leaf name, 'Temporary directory', or 'Unknown location'. */
  label: Schema.String,
  /** Home-abbreviated display path (`~/…`), or `null` when there is no path to show. Never a raw absolute path. */
  detail: Schema.NullOr(Schema.String),
})

export const usageCostSessionRowSchema = Schema.Struct({
  ...usageCostBucketFields,
  sessionId: Schema.NullOr(Schema.String),
  /** The Pi session's latest `/name`, else its first prompt, shortened; `null` when it has neither. */
  title: Schema.NullOr(Schema.String),
  /** Absolute session file path; the drill-down key. */
  file: Schema.String,
  /** Display label of the session's owning project, or `null`. */
  projectLabel: Schema.NullOr(Schema.String),
  /** Home-abbreviated display path for the session cwd (`~/…`), or `null`. Never a raw absolute path. */
  displayCwd: Schema.NullOr(Schema.String),
  origin: usageCostSessionOriginSchema,
  startedAtMs: Schema.NullOr(Schema.Number),
  lastActivityMs: Schema.NullOr(Schema.Number),
})

export const usageCostViewSchema = Schema.Struct({
  query: usageCostQuerySchema,
  generatedAtMs: Schema.Number,
  rangeStartMs: Schema.NullOr(Schema.Number),
  rangeEndMs: Schema.Number,
  totals: usageCostBucketSchema,
  /** `unpricedTokens / tokens.total`, 0 when nothing was scanned. */
  unpricedShare: Schema.Number,
  days: Schema.Array(usageCostDaySchema),
  models: Schema.Array(usageCostModelRowSchema),
  projects: Schema.Array(usageCostProjectRowSchema),
  sessionCount: Schema.Number,
  scannedFiles: Schema.Number,
  scannedFilesCached: Schema.Number,
  scanDurationMs: Schema.Number,
})

export const usageCostSessionsResultSchema = Schema.Struct({
  query: usageCostSessionQuerySchema,
  sessions: Schema.Array(usageCostSessionRowSchema),
  generatedAtMs: Schema.Number,
})
