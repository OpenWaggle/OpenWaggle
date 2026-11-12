import { Schema } from '@shared/schema'

/**
 * A Session Host command result as the CLI reads it: the `response.outcome` object, whose members
 * each reader checks where it uses them.
 */
const commandOutcomeSchema = Schema.Struct({
  response: Schema.Struct({ outcome: Schema.Object }),
})

/** The result's `response.outcome` object, or `undefined` when the result carries none. */
export function commandResponseOutcome(value: unknown): object | undefined {
  return Schema.is(commandOutcomeSchema)(value) && !Array.isArray(value.response.outcome)
    ? value.response.outcome
    : undefined
}

/** The members of a refused page's `error` the CLI reports. */
export interface PageQueryRefusalFields {
  readonly kind?: unknown
  readonly code?: unknown
  readonly message?: unknown
}

/** A page outcome's `error`, when the Host refused the page. */
export function pageRefusalOf(outcome: object): PageQueryRefusalFields | undefined {
  if (!('error' in outcome)) return undefined
  const { error } = outcome
  return typeof error === 'object' && error !== null && !Array.isArray(error) ? error : undefined
}
