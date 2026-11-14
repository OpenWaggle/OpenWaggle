/**
 * Returns `value` without `key`. Under exactOptionalPropertyTypes an optional property cannot be
 * set to undefined, so a fixture that needs the property absent leaves it out.
 */
export function omitKey<T extends object, K extends keyof T>(value: T, key: K) {
  const { [key]: _omitted, ...rest } = value
  return rest
}
