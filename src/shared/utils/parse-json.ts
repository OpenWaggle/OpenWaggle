import {
  decodeUnknownOrThrow,
  type Schema,
  type SchemaType,
  safeDecodeUnknown,
} from '@shared/schema'

/**
 * Parse a JSON string and validate against an Effect schema.
 * Throws on invalid JSON or schema mismatch.
 */
export function parseJson<TSchema extends Schema.Schema.AnyNoContext>(
  raw: string,
  schema: TSchema,
): SchemaType<TSchema>
export function parseJson<TSchema extends Schema.Schema.AnyNoContext>(
  raw: string,
  schema: TSchema,
): SchemaType<TSchema> {
  const data: unknown = JSON.parse(raw)
  return decodeUnknownOrThrow(schema, data)
}

/**
 * Parse a JSON string and safely validate against an Effect schema.
 * On JSON syntax errors, returns `{ success: false, data: undefined }`.
 */
export function parseJsonSafe<TSchema extends Schema.Schema.AnyNoContext>(
  raw: string,
  schema: TSchema,
): { success: true; data: SchemaType<TSchema> } | { success: false; data: undefined }
export function parseJsonSafe<TSchema extends Schema.Schema.AnyNoContext>(
  raw: string,
  schema: TSchema,
): { success: true; data: SchemaType<TSchema> } | { success: false; data: undefined } {
  try {
    const data: unknown = JSON.parse(raw)
    const result = safeDecodeUnknown(schema, data)
    if (result.success) {
      return { success: true, data: result.data }
    }
    return { success: false, data: undefined }
  } catch {
    return { success: false, data: undefined }
  }
}
