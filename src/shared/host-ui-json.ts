export type HostUiJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly HostUiJsonValue[]
  | { readonly [key: string]: HostUiJsonValue }

function jsonValue(value: unknown, ancestors: Set<object>): HostUiJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value
    throw new Error('Host UI transport accepts only finite numbers.')
  }
  if (typeof value !== 'object') {
    throw new Error(`Host UI transport cannot encode ${typeof value} values.`)
  }
  if (ancestors.has(value)) throw new Error('Host UI transport cannot encode cyclic values.')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const result: HostUiJsonValue[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new Error('Host UI transport cannot encode sparse arrays.')
        }
        result.push(jsonValue(value[index], ancestors))
      }
      return result
    }
    const prototype = Reflect.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Host UI transport accepts only plain objects.')
    }
    const result: Record<string, HostUiJsonValue> = {}
    for (const [key, nested] of Object.entries(value)) {
      // JSON object semantics omit optional properties. Normalize that explicitly here so the
      // framed path matches ordinary hydrated Session DTOs instead of relying on JSON.stringify.
      if (nested === undefined) continue
      result[key] = jsonValue(nested, ancestors)
    }
    return result
  } finally {
    ancestors.delete(value)
  }
}

export function toHostUiJsonValue(value: unknown): HostUiJsonValue {
  return jsonValue(value, new Set())
}
