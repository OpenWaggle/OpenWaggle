import { Schema } from '@shared/schema'

export { waggleConfigSchema } from '@shared/schemas/waggle'

export const expandedNodeIdsSchema = Schema.mutable(Schema.Array(Schema.String))

export const activeRunRuntimeSchema = Schema.Struct({
  model: Schema.String,
})
