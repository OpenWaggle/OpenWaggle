export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonObject | JsonArray

export interface JsonObject {
  readonly [key: string]: JsonValue
}

export type JsonArray = readonly JsonValue[]
