import { Schema } from '@shared/schema'

/** The single source of the context usage types in `@shared/types/context-usage`. */

/** Token and cost totals of one model, or of usage no model is named on (`model: null`). */
export const sessionModelUsageSchema = Schema.Struct({
  model: Schema.NullOr(Schema.String),
  tokens: Schema.Number,
  /** US dollars, as the provider prices it. */
  cost: Schema.Number,
})

/** A Session's usage so far, like Pi's `/session`: totals and the share of each physical model. */
export const sessionUsageSummarySchema = Schema.Struct({
  tokens: Schema.Number,
  cost: Schema.Number,
  models: Schema.Array(sessionModelUsageSchema),
})

export const contextUsageSnapshotSchema = Schema.Struct({
  /** Estimated context tokens, or null when Pi marks usage unknown after compaction. */
  tokens: Schema.NullOr(Schema.Number),
  contextWindow: Schema.Number,
  /** Percentage of context window used, or null when token usage is unknown. */
  percent: Schema.NullOr(Schema.Number),
  /** The Session's token and cost totals, when it has any. */
  session: Schema.optionalWith(sessionUsageSummarySchema, { exact: true }),
})

export const contextCompactionResultSchema = Schema.Struct({
  summary: Schema.String,
  firstKeptEntryId: Schema.String,
  tokensBefore: Schema.Number,
})
