import { isRecord } from '@shared/utils/validation'
import { piLiteral } from '../../../domain/mcp/config/mcp-pi-literal'
import { resolveRegistryInput } from './registry-inputs'

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

function secretReference(name: string): RegistryEntryValue {
  return { secret: name.replace(INVALID_SECRET_CHARACTERS, '_').toUpperCase() }
}

/**
 * One declared value: a literal when its value or default (with `{variables}` filled) is known, a
 * vault reference named after it for a secret, a value built from a secret variable (the whole
 * value is then the secret), or a required value it has none for; left out otherwise.
 */
function declaredValue(
  name: string,
  candidate: Readonly<Record<string, unknown>>,
): RegistryEntryValue | undefined {
  if (candidate.isSecret === true) return secretReference(name)
  const resolved = resolveRegistryInput(candidate)
  if (resolved.kind === 'value') {
    return resolved.usesSecret ? secretReference(name) : piLiteral(resolved.value)
  }
  const required =
    candidate.isRequired === true || (resolved.kind === 'unfilled' && resolved.required)
  if (resolved.kind === 'unfilled' && resolved.secret) return secretReference(name)
  return required ? secretReference(name) : undefined
}

/** The environment variables or headers a Registry entry declares, as `declaredValue` makes them. */
export function declaredRegistryValues(value: unknown, kind: 'env' | 'header') {
  const pattern = kind === 'env' ? ENVIRONMENT_NAME : HEADER_NAME
  const result: Record<string, RegistryEntryValue> = {}
  for (const candidate of arrayValue(value)) {
    if (!isRecord(candidate)) continue
    const name = stringValue(candidate.name)
    if (!name || !pattern.test(name)) continue
    const declared = declaredValue(name, candidate)
    if (declared !== undefined) result[name] = declared
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
