import { Schema } from '@shared/schema'

export const expandedNodeIdsSchema = Schema.mutable(Schema.Array(Schema.String))
export const waggleConfigSchema = Schema.Struct({
  mode: Schema.Literal('sequential'),
  agents: Schema.Tuple(
    Schema.Struct({
      label: Schema.String,
      model: Schema.String,
      roleDescription: Schema.String,
      color: Schema.Literal('blue', 'amber', 'emerald', 'violet'),
    }),
    Schema.Struct({
      label: Schema.String,
      model: Schema.String,
      roleDescription: Schema.String,
      color: Schema.Literal('blue', 'amber', 'emerald', 'violet'),
    }),
  ),
  stop: Schema.Struct({
    primary: Schema.Literal('consensus', 'user-stop'),
    maxTurnsSafety: Schema.Number,
  }),
})

export const activeRunRuntimeSchema = Schema.Struct({
  model: Schema.String,
})
