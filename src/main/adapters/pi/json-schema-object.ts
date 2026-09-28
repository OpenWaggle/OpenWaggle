import { isMatching, P } from '@diegogbrisa/ts-match'

export type JsonSchemaObject = { readonly [key: string]: unknown }
export type MutableJsonSchema = { [key: string]: unknown }

export function isJsonSchemaObject(value: unknown): value is JsonSchemaObject {
  return isMatching(P.record(P.string, P._), value) && !Array.isArray(value)
}

export function propertiesOf(schema: JsonSchemaObject): JsonSchemaObject {
  return isJsonSchemaObject(schema.properties) ? schema.properties : {}
}

export function requiredOf(schema: JsonSchemaObject): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : []
}

export function schemaArray(value: unknown): JsonSchemaObject[] | undefined {
  return Array.isArray(value) ? value.filter(isJsonSchemaObject) : undefined
}

const LOCAL_POINTER_PREFIX = '#/'

/** Resolves a local JSON pointer (`#/...`) in `document`, or `undefined` when it does not. */
export function resolvePointer(
  document: JsonSchemaObject,
  reference: string,
): JsonSchemaObject | undefined {
  if (reference === '#') return document
  if (!reference.startsWith(LOCAL_POINTER_PREFIX)) return undefined
  let current: unknown = document
  // RFC 6901 §6: percent-decode the fragment first, then split, then unescape `~1` and `~0`.
  let pointer: string
  try {
    pointer = decodeURIComponent(reference.slice(LOCAL_POINTER_PREFIX.length))
  } catch {
    return undefined
  }
  for (const rawSegment of pointer.split('/')) {
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~')
    if (!isJsonSchemaObject(current)) return undefined
    current = current[segment]
  }
  return isJsonSchemaObject(current) ? current : undefined
}
