/**
 * The schemas the Host decodes a scalar Host UI argument with. A refusal is the argument's
 * own message, which names it (`Project path must be a non-empty string.`), so the caller sees
 * the text these checks always gave.
 */
import { Schema } from '@shared/schema'
import { SESSION_INPUT_LIMITS } from '@shared/session-input-limits'
import { SupportedModelId } from '@shared/types/brand'
import { PROVIDER_CATALOG_SCOPES, parseModelRef } from '@shared/types/llm'
import { THINKING_LEVELS } from '@shared/types/settings'

/** Replaces every issue the schema reports, its members' and refinements' included. */
function refusal(message: string) {
  return { message: () => ({ message, override: true }) }
}

/** The schema with one refusal message, which names the argument it decodes. */
export function withArgumentRefusal<A, I>(schema: Schema.Schema<A, I>, message: string) {
  return schema.annotations(refusal(message))
}

/** A string with more than whitespace; anything else is refused with one message. */
export function hostUiNonBlankStringSchema(label: string) {
  return Schema.String.pipe(Schema.filter((value) => value.trim().length > 0)).annotations(
    refusal(`${label} must be a non-empty string.`),
  )
}

export function hostUiStringSchema(label: string) {
  return Schema.String.annotations(refusal(`${label} must be a string.`))
}

/** A non-blank Session operation string no longer than a path may be. */
export function sessionOperationStringSchema(label: string) {
  return hostUiNonBlankStringSchema(label).pipe(
    Schema.filter((value) => value.length <= SESSION_INPUT_LIMITS.pathLength, {
      message: () => `${label} exceeds the input limit.`,
    }),
  )
}

/** A canonical `provider/model` reference, branded once it decodes. */
export const sessionModelArgumentSchema = sessionOperationStringSchema('Session model').pipe(
  Schema.filter((model) => parseModelRef(model) !== null, {
    message: () => 'Session model must be a canonical provider/model reference.',
  }),
  Schema.fromBrand(SupportedModelId),
)

export const thinkingLevelArgumentSchema = Schema.Literal(...THINKING_LEVELS).annotations(
  refusal(`Thinking level must be one of ${THINKING_LEVELS.join(', ')}.`),
)

export const optionalProjectPathArgumentSchema = Schema.Union(
  Schema.Undefined,
  Schema.Null,
  Schema.String,
).annotations(refusal('Project path must be a string, null, or omitted.'))

export const providerCatalogScopeArgumentSchema = Schema.Literal(
  ...PROVIDER_CATALOG_SCOPES,
).annotations(
  refusal(`Provider catalog scope must be one of ${PROVIDER_CATALOG_SCOPES.join(', ')}.`),
)
