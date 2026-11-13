function isPlainObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * `value` without the keys whose value is `undefined`, through every plain object and array.
 * postMessage and Electron IPC keep such keys, and an exact optional schema field refuses them, so
 * an inbound boundary drops them once before it decodes.
 */
export function withoutUndefinedProperties(value: unknown) {
  const result: unknown = Array.isArray(value)
    ? value.map((item: unknown) => withoutUndefinedProperties(item))
    : isPlainObject(value)
      ? Object.fromEntries(
          Object.entries(value).flatMap(([key, item]: [string, unknown]) =>
            item === undefined ? [] : [[key, withoutUndefinedProperties(item)]],
          ),
        )
      : value
  return result
}
