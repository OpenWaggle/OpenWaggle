/**
 * `value` as JSON text where `JSON.stringify` alone would throw or lose the reason: a bigint
 * becomes its digits, an error `Name: message`, and an object met again `[Circular]`. Structured
 * clone carries bigints and cycles across IPC, and `String(value)` would print `[object Object]`.
 */
export function lenientJsonStringify(value: unknown, space?: number) {
  const seen = new WeakSet()
  return JSON.stringify(
    value,
    (_key, item: unknown) => {
      if (item instanceof Error) return `${item.name}: ${item.message}`
      if (typeof item === 'bigint') return item.toString()
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) return '[Circular]'
        seen.add(item)
      }
      return item
    },
    space,
  )
}
