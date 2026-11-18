/**
 * Reads the fields a script needs from outside JSON (manifests, API responses, reports) through a
 * schema, so each is a declared property read with dot access [TS-06]. Tolerant readers declare
 * fields as `unknownField` and check each one where it is used; strict readers declare its type.
 */
import { Schema } from '@shared/schema'

/** A field that may be absent and is checked where it is read. */
export const unknownField = Schema.optionalWith(Schema.Unknown, { exact: true })

/** `value` typed by `schema` when it is a non-array object the schema accepts, else undefined. */
export function objectFields<A, I>(schema: Schema.Schema<A, I>, value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return Schema.is(schema)(value) ? value : undefined
}

/**
 * A JSON object read as a map keyed by runtime names (a lockfile's packages, a packument's
 * versions): its entries, each value checked where it is used. `undefined` for anything else.
 */
export function objectEntries(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const result: readonly (readonly [string, unknown])[] | undefined = Object.entries(value)
  return result
}

/** {@link objectEntries} as a map, for a lookup by a runtime key. */
export function objectMap(value: unknown) {
  const entries = objectEntries(value)
  const map: ReadonlyMap<string, unknown> | undefined =
    entries === undefined ? undefined : new Map(entries)
  return map
}
