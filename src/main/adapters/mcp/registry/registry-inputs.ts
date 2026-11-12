/**
 * A Registry `Input` (server.json `InputWithVariables`): an argument, environment variable, or
 * header with a `value` or `default`, whose `{name}` placeholders are filled from the `variables`
 * it declares. A placeholder no variable declares is literal text.
 */
import { isRecord } from '@shared/utils/validation'

export type RegistryInputResolution =
  /** `usesSecret`: a secret variable went into it, so the whole value is a secret. */
  | { readonly kind: 'value'; readonly value: string; readonly usesSecret: boolean }
  /** No value and no default. */
  | { readonly kind: 'empty' }
  /** A declared variable has no value and no default. */
  | {
      readonly kind: 'unfilled'
      readonly variable: string
      readonly required: boolean
      readonly secret: boolean
    }

const VARIABLE_PATTERN = /\{([^{}]+)\}/g

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function resolveRegistryInput(input: Readonly<Record<string, unknown>>) {
  const raw = text(input.value) ?? text(input.default)
  if (raw === undefined) return { kind: 'empty' } satisfies RegistryInputResolution
  const variables = isRecord(input.variables) ? input.variables : {}
  let unfilled: RegistryInputResolution | undefined
  let usesSecret = false
  const value = raw.replace(VARIABLE_PATTERN, (placeholder, name: string) => {
    const variable = variables[name]
    if (!isRecord(variable)) return placeholder
    const secret = variable.isSecret === true
    usesSecret ||= secret
    const filled = text(variable.value) ?? text(variable.default)
    if (filled === undefined) {
      unfilled ??= {
        kind: 'unfilled',
        variable: name,
        required: variable.isRequired === true,
        secret,
      }
    }
    return filled ?? placeholder
  })
  return unfilled ?? ({ kind: 'value', value, usesSecret } satisfies RegistryInputResolution)
}

/** The install cannot go on without a value the Registry entry does not give. */
export function missingRegistryValue(name: string) {
  return new Error(
    `The Registry server needs a value for ${name}, which it does not provide. Add the server by hand with that value.`,
  )
}
