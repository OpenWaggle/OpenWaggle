import { isMatching, P } from '@diegogbrisa/ts-match'
import { decodeUnknownOrThrow, Schema, type SchemaType } from '@shared/schema'

export type JsonSchemaObject = Readonly<Record<string, unknown>>
export type MutableJsonSchema = Record<string, unknown>

export function isJsonSchemaObject(value: unknown): value is JsonSchemaObject {
  return isMatching(P.record(P.string, P._), value) && !Array.isArray(value)
}

const keyword = Schema.optional(Schema.Unknown)

/**
 * The JSON Schema keywords OpenWaggle reads when it checks or rewrites a tool schema. A schema
 * may carry any keyword and is passed on with all of them; these are only read, each still
 * unknown, because a keyword of the wrong type is something the readers report or repair.
 */
const jsonSchemaKeywordsSchema = Schema.Struct({
  type: keyword,
  properties: keyword,
  required: keyword,
  description: keyword,
  title: keyword,
  $schema: keyword,
  $ref: keyword,
  $id: keyword,
  $defs: keyword,
  definitions: keyword,
  const: keyword,
  enum: keyword,
  items: keyword,
  additionalProperties: keyword,
  anyOf: keyword,
  oneOf: keyword,
  allOf: keyword,
})

export type JsonSchemaKeywords = SchemaType<typeof jsonSchemaKeywordsSchema>

/** The keywords of a schema object this code reads. */
export function keywordsOf(schema: object): JsonSchemaKeywords {
  return decodeUnknownOrThrow(jsonSchemaKeywordsSchema, schema)
}

export function propertiesOf(schema: JsonSchemaObject): JsonSchemaObject {
  const { properties } = keywordsOf(schema)
  return isJsonSchemaObject(properties) ? properties : {}
}

export function requiredOf(schema: JsonSchemaObject): string[] {
  const { required } = keywordsOf(schema)
  return Array.isArray(required)
    ? required.filter((key): key is string => typeof key === 'string')
    : []
}

export function schemaArray(value: unknown): JsonSchemaObject[] | undefined {
  return Array.isArray(value) ? value.filter(isJsonSchemaObject) : undefined
}

export const LOCAL_POINTER_PREFIX = '#/'

/**
 * The reference tokens of a local JSON pointer (`#/...`), or `undefined` for other references
 * and malformed escapes. RFC 6901 §6: percent-decode the fragment first, then split, then
 * unescape `~1` and `~0`, so `%2F` is a separator and a literal `/` must be written `~1`.
 */
export function decodePointerSegments(reference: string): string[] | undefined {
  if (!reference.startsWith(LOCAL_POINTER_PREFIX)) return undefined
  try {
    return decodeURIComponent(reference.slice(LOCAL_POINTER_PREFIX.length))
      .split('/')
      .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
  } catch {
    return undefined
  }
}

/** Resolves a local JSON pointer (`#/...`) in `document`, or `undefined` when it does not. */
export function resolvePointer(
  document: JsonSchemaObject,
  reference: string,
): JsonSchemaObject | undefined {
  if (reference === '#') return document
  const segments = decodePointerSegments(reference)
  if (!segments) return undefined
  let current: unknown = document
  for (const segment of segments) {
    if (!isJsonSchemaObject(current)) return undefined
    current = current[segment]
  }
  return isJsonSchemaObject(current) ? current : undefined
}
