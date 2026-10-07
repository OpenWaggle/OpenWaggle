import { isRecord } from '@shared/utils/validation'

/** An `env` or `headers` value in an OpenWaggle MCP file: a literal or a vault reference. */
export type RegistryEntryValue = string | { readonly secret: string }

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const INVALID_SECRET_CHARACTERS = /[^A-Za-z0-9._-]+/g

export function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value.map((entry: unknown) => entry) : []
}

/**
 * Pi reads `$NAME`, `${NAME}`, and a leading `!command` in `env` and `headers` values. Values that
 * come from the Registry or a bundle manifest are data, so they are written so Pi reads them back
 * literally: `$$` is a literal `$`, and `$!` a literal `!`.
 */
export function piLiteral(value: string) {
  const escaped = value.replaceAll('$', () => '$$')
  return escaped.startsWith('!') ? `$${escaped}` : escaped
}

export function piLiteralMap(values: Readonly<Record<string, string>> | undefined) {
  if (!values) return undefined
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, piLiteral(value)]))
}

function secretReference(name: string): RegistryEntryValue {
  return { secret: name.replace(INVALID_SECRET_CHARACTERS, '_').toUpperCase() }
}

/**
 * The environment variables or headers a Registry entry declares. A secret, or a value without
 * a default, becomes a vault reference named after it; a default becomes a literal.
 */
export function declaredRegistryValues(value: unknown, kind: 'env' | 'header') {
  const pattern = kind === 'env' ? ENVIRONMENT_NAME : HEADER_NAME
  const result: Record<string, RegistryEntryValue> = {}
  for (const candidate of arrayValue(value)) {
    if (!isRecord(candidate)) continue
    const name = stringValue(candidate.name)
    if (!name || !pattern.test(name)) continue
    const fallback = stringValue(candidate.default) ?? stringValue(candidate.value)
    result[name] =
      candidate.isSecret === true || !fallback ? secretReference(name) : piLiteral(fallback)
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** The vault secrets an entry's values read. */
export function referencedSecrets(
  ...maps: (Readonly<Record<string, RegistryEntryValue>> | undefined)[]
) {
  const names = new Set<string>()
  for (const map of maps) {
    for (const value of Object.values(map ?? {})) {
      if (typeof value !== 'string') names.add(value.secret)
    }
  }
  return [...names].sort()
}
