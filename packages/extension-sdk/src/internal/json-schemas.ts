import * as Schema from 'effect/Schema'
import type { JsonValue } from '../json.js'

export const jsonPrimitiveSchema = Schema.Union(
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
)

export const jsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    jsonPrimitiveSchema,
    Schema.mutable(Schema.Array(jsonValueSchema)),
    Schema.mutable(Schema.Record({ key: Schema.String, value: jsonValueSchema })),
  ),
)
