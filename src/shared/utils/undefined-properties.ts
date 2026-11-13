import * as Option from 'effect/Option'

function isPlainObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/*
 * `ancestors` holds the objects on the path to `value`, not every object seen, so a payload that
 * holds one object twice is still a tree of values; only an object inside itself is a cycle.
 */
function withinAncestors(
  value: object,
  ancestors: WeakSet<object>,
  strip: () => Option.Option<unknown>,
) {
  if (ancestors.has(value)) return Option.none()
  ancestors.add(value)
  const result = strip()
  ancestors.delete(value)
  return result
}

// Recursive, so TypeScript needs the return type to infer the calls inside it.
function strip(value: unknown, ancestors: WeakSet<object>): Option.Option<unknown> {
  return Array.isArray(value)
    ? withinAncestors(value, ancestors, () =>
        Option.all(value.map((item: unknown) => strip(item, ancestors))),
      )
    : isPlainObject(value)
      ? withinAncestors(value, ancestors, () =>
          Option.map(
            Option.all(
              Object.entries(value).flatMap(([key, item]: [string, unknown]) =>
                item === undefined
                  ? []
                  : [Option.map(strip(item, ancestors), (stripped) => [key, stripped] as const)],
              ),
            ),
            (entries) => Object.fromEntries(entries),
          ),
        )
      : Option.some(value)
}

/**
 * `value` without the keys whose value is `undefined`, through every plain object and array.
 * postMessage and Electron IPC keep such keys, and an exact optional schema field refuses them, so
 * an inbound boundary drops them once before it decodes. Both also carry cycles, which no schema
 * accepts: a value that contains itself gives `None` instead of overflowing the stack.
 */
export function withoutUndefinedProperties(value: unknown) {
  return strip(value, new WeakSet())
}
