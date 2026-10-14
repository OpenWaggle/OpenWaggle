import { Schema } from '@shared/schema'
import { USAGE_COST_ORIGIN_FILTERS, USAGE_COST_RANGE_PRESETS } from '@shared/types/usage-cost'

export const usageCostQuerySchema = Schema.Struct({
  preset: Schema.Literal(...USAGE_COST_RANGE_PRESETS),
  origin: Schema.Literal(...USAGE_COST_ORIGIN_FILTERS),
})

export const usageCostSessionQuerySchema = Schema.Struct({
  preset: Schema.Literal(...USAGE_COST_RANGE_PRESETS),
  origin: Schema.Literal(...USAGE_COST_ORIGIN_FILTERS),
  day: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  modelId: Schema.optional(Schema.String),
  projectPath: Schema.optional(Schema.NullOr(Schema.String)),
})
