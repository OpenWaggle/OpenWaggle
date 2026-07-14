import * as Schema from 'effect/Schema'

export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonObject | JsonArray

export interface JsonObject {
  [key: string]: JsonValue
}

export type JsonArray = JsonValue[]

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
