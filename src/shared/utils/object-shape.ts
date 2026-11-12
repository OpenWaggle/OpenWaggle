import type { UncheckedFields } from '../types/unchecked-fields'

/**
 * A non-null, non-array object. Guards that cannot load a schema (bundles under a size budget,
 * such as the syntax worker) start from it and narrow each declared field with `'name' in value`,
 * which gives the field a declared type, so it is read with dot access.
 */
export function isObjectValue(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The fields of `T` an outside value holds, each unchecked; none for a value that is not an object. */
export function uncheckedFields<T>(value: unknown): UncheckedFields<T> {
  return isObjectValue(value) ? value : {}
}
