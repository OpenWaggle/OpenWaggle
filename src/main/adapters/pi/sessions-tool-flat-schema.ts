import { isMatching, P } from '@diegogbrisa/ts-match'
import { type TProperties, type TSchema, type TUnsafe, Type } from 'typebox'
import { Check, Errors } from 'typebox/value'
import { type SessionsToolParameters, sessionsToolParameters } from './sessions-tool-parameters'

/** Loose structural view of a union member for run-time schema surgery. */
export interface SessionsToolRuntimeVariant {
  readonly properties: TProperties
}

/** Enumerate the concrete `action` literal schemas a variant declares. */
export function actionChoices(action: unknown): { const: string }[] {
  if (isMatching({ const: P.string }, action)) return [action]
  if (isMatching({ anyOf: P.array({ const: P.string }) }, action)) return [...action.anyOf]
  return []
}

function variantActionName(variant: SessionsToolRuntimeVariant): string | undefined {
  return actionChoices(variant.properties.action)[0]?.const
}

/**
 * Some parameter groups share one variant across several actions via an action literal
 * union. Expand them so every runtime variant declares exactly one `action` const, which
 * keeps capability filtering and per-action runtime validation uniform.
 */
function singleActionVariants(
  variants: readonly SessionsToolRuntimeVariant[],
): SessionsToolRuntimeVariant[] {
  return variants.flatMap((variant) => {
    const choices = actionChoices(variant.properties.action)
    if (choices.length <= 1) return [variant]
    const { action: _sharedAction, ...shared } = variant.properties
    return choices.map((choice) => ({ properties: { action: choice, ...shared } }))
  })
}

export const sessionsToolParameterVariants: readonly SessionsToolRuntimeVariant[] =
  singleActionVariants(sessionsToolParameters.anyOf)

/**
 * The provider-facing sessions tool schema: a single object with `action` as a literal
 * union and every other property optional. Root-level anyOf unions break tool-call
 * argument emission on some providers (GLM via OpenRouter returns `{}`), so variants must
 * never be exposed as alternatives at the schema root. The static type stays the
 * per-action union via Type.Unsafe; exact variant contracts are enforced at run time by
 * assertSessionsToolActionArguments.
 */
export function flattenSessionsToolParameters(
  variants: readonly SessionsToolRuntimeVariant[],
): TUnsafe<SessionsToolParameters> {
  const actions: TSchema[] = []
  const propertiesByKey = new Map<string, TSchema[]>()
  for (const variant of variants) {
    actions.push(variant.properties.action)
    for (const [key, schema] of Object.entries(variant.properties)) {
      if (key === 'action') continue
      const existing = propertiesByKey.get(key) ?? []
      if (!existing.some((candidate) => JSON.stringify(candidate) === JSON.stringify(schema))) {
        existing.push(schema)
      }
      propertiesByKey.set(key, existing)
    }
  }
  const properties: Record<string, TSchema> = {}
  for (const [key, occurrences] of propertiesByKey) {
    const merged = occurrences.length === 1 ? occurrences[0] : Type.Union(occurrences)
    // Every non-action property is optional in the flat schema because required-ness is
    // per-action and cannot be expressed here; assertSessionsToolActionArguments enforces
    // each variant's contract at run time.
    properties[key] = Type.Optional(merged)
  }
  return Type.Unsafe<SessionsToolParameters>({
    type: 'object',
    properties: {
      action: Type.Union(actions.length > 0 ? actions : [Type.Literal('__no_permitted_actions__')]),
      ...properties,
    },
    required: ['action'],
  })
}

/**
 * The flattened provider schema cannot express per-action required fields, so enforce the
 * selected variant's contract here with an error the model can act on.
 */
export function assertSessionsToolActionArguments(params: SessionsToolParameters): void {
  const variant = sessionsToolParameterVariants.find(
    (candidate) => variantActionName(candidate) === params.action,
  )
  const valid: boolean = variant !== undefined && Check(variant, params)
  if (valid) return
  if (variant === undefined) return
  const details = [...Errors(variant, params)]
    .map((error) => `${error.instancePath || 'arguments'}: ${error.message}`)
    .join('; ')
  throw new Error(`Invalid arguments for sessions action "${params.action}": ${details}`)
}
