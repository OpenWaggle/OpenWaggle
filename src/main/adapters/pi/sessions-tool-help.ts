import { isMatching, P } from '@diegogbrisa/ts-match'
import { propertiesOf, requiredOf } from './json-schema-object'
import { type SessionsToolRuntimeVariant, variantActionName } from './sessions-tool-flat-schema'
import { HIVE_HELP_ACTION, hiveActionSchema } from './sessions-tool-hot-schema'

export interface HiveHelpInput {
  /** The parameter variants of the actions this Session may use. */
  readonly variants: readonly SessionsToolRuntimeVariant[]
  /** Every Hive rule for this Session's grant; the system prompt carries only the essentials. */
  readonly guidelines: readonly string[]
  readonly topic?: unknown
}

function actionLine(variant: SessionsToolRuntimeVariant) {
  const schema = hiveActionSchema(variant)
  const required = new Set(requiredOf(schema))
  const parameters = Object.keys(propertiesOf(schema))
    .filter((key) => key !== 'action')
    .map((key) => (required.has(key) ? `${key}*` : key))
  return `- ${variantActionName(variant)}(${parameters.join(', ')})`
}

function mentions(guideline: string, action: string) {
  return new RegExp(`(^|[^A-Za-z0-9_])${action}([^A-Za-z0-9_]|$)`).test(guideline)
}

function overview(input: HiveHelpInput) {
  const text = [
    'Hive actions this Session can use. Pass parameters at the top level; * marks required ones. Call help with topic <action> for its full schema. Results are compact and capped at 32 KB (an items page then ends early with nextCreatedOrder); verbose: true keeps the response envelope and item metadata, under the same cap.',
    ...input.variants.map(actionLine),
    '',
    'Hive rules:',
    ...input.guidelines.map((guideline) => `- ${guideline}`),
  ].join('\n')
  return { text, details: { actions: input.variants.map(variantActionName) } }
}

/**
 * What `hive({ action: "help" })` returns: every permitted action with its parameter names and
 * the full Hive rules, or with `topic` one action's complete schema and the rules that name it.
 * The Host is never called.
 */
export function hiveHelp(input: HiveHelpInput) {
  if (input.topic === undefined || input.topic === HIVE_HELP_ACTION) return overview(input)
  const topic = isMatching(P.string, input.topic) ? input.topic : String(input.topic)
  const variant = input.variants.find((candidate) => variantActionName(candidate) === topic)
  if (!variant) {
    throw new Error(
      `No hive action "${topic}" for this Session. Actions: ${input.variants.map(variantActionName).join(', ')}.`,
    )
  }
  const details = {
    action: topic,
    parameters: hiveActionSchema(variant),
    rules: input.guidelines.filter((guideline) => mentions(guideline, topic)),
  }
  return { text: JSON.stringify(details), details }
}
