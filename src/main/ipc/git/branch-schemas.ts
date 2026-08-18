import { Schema } from '@shared/schema'

export const branchCheckoutPayloadSchema = Schema.Struct({
  name: Schema.String,
})

export const branchCreatePayloadSchema = Schema.Struct({
  name: Schema.String,
  startPoint: Schema.optional(Schema.String),
  checkout: Schema.optional(Schema.Boolean),
})
