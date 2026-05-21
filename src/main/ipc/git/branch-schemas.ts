import { Schema } from '@shared/schema'

export const branchCheckoutPayloadSchema = Schema.Struct({
  name: Schema.String,
})

export const branchCreatePayloadSchema = Schema.Struct({
  name: Schema.String,
  startPoint: Schema.optional(Schema.String),
  checkout: Schema.optional(Schema.Boolean),
})

export const branchRenamePayloadSchema = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
})

export const branchDeletePayloadSchema = Schema.Struct({
  name: Schema.String,
  force: Schema.optional(Schema.Boolean),
})

export const branchSetUpstreamPayloadSchema = Schema.Struct({
  name: Schema.String,
  upstream: Schema.String,
})
