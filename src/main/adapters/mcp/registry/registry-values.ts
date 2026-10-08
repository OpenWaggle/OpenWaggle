import { isRecord } from '@shared/utils/validation'
import { piLiteral } from '../../../domain/mcp/config/mcp-pi-literal'
import { type RegistryInputResolution, resolveRegistryInput } from './registry-inputs'

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

type RegistryInput = Readonly<Record<string, unknown>>

function isRequiredInput(candidate: RegistryInput, resolved: RegistryInputResolution) {
  return candidate.isRequired === true || (resolved.kind === 'unfilled' && resolved.required)
}

function isSecretInput(candidate: RegistryInput, resolved: RegistryInputResolution) {
  return (
    candidate.isSecret === true ||
    (resolved.kind === 'value' && resolved.usesSecret) ||
    (resolved.kind === 'unfilled' && resolved.secret)
  )
}

/**
 * A secret the server starts without: an optional secret input, or one built from an optional
 * secret variable. It is left out of the entry, so the server is not stopped waiting for it, and
 * listed instead.
 */
export function isOptionalRegistrySecret(
  candidate: RegistryInput,
  resolved: RegistryInputResolution = resolveRegistryInput(candidate),
) {
  return isSecretInput(candidate, resolved) && !isRequiredInput(candidate, resolved)
}

/**
 * One declared value: a vault reference named after it for a required secret, or a value built
 * from a required secret variable (the whole value is then the secret); a literal when its value
 * or default (with `{variables}` filled) is known; a vault reference for a required value it has
 * none for; left out otherwise, as is an optional secret.
 */
function declaredValue(name: string, candidate: RegistryInput): RegistryEntryValue | undefined {
  const resolved = resolveRegistryInput(candidate)
  if (isOptionalRegistrySecret(candidate, resolved)) return undefined
  if (isSecretInput(candidate, resolved)) return secretReference(name)
  if (resolved.kind === 'value') return piLiteral(resolved.value)
  return isRequiredInput(candidate, resolved) ? secretReference(name) : undefined
}

/** The names of the optional secrets in Registry inputs, which an install leaves out. */
export function optionalRegistrySecrets(...lists: unknown[]) {
  return lists.flatMap((list) =>
    arrayValue(list).flatMap((candidate) =>
      isRecord(candidate) && isOptionalRegistrySecret(candidate)
        ? [
            stringValue(candidate.name) ??
              stringValue(candidate.valueHint) ??
              'a positional argument',
          ]
        : [],
    ),
  )
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
