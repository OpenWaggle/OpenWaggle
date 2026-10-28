import { type TUnsafe, Type } from 'typebox'
import {
  isJsonSchemaObject,
  type JsonSchemaObject,
  propertiesOf,
  requiredOf,
  schemaArray,
} from './json-schema-object'
import {
  flattenSessionsToolParameters,
  type SessionsToolRuntimeVariant,
  variantActionName,
} from './sessions-tool-flat-schema'
import type { SessionsToolParameters } from './sessions-tool-parameters'
import { literalUnionsAsEnums } from './tool-schema-enums'

/** The action that describes every other one; it never reaches the Session Host. */
export const HIVE_HELP_ACTION = 'help'

/**
 * The actions Hive Sessions call most (about 90% of 22,000 recorded hive calls) and the
 * properties the declared schema types for each. Every other action, and every other property
 * of these, is still accepted at the top level and checked against its full contract by
 * `assertSessionsToolActionArguments`; `hive({ action: "help" })` describes them (C6 of the v1
 * performance research: the full schema was about 4,800 o200k tokens on every request).
 */
const HOT_ACTION_PROPERTIES: ReadonlyMap<string, readonly string[]> = new Map([
  ['spawn', ['objective', 'title', 'workspace', 'deliverables', 'acceptanceCriteria']],
  ['wait', ['sessionIds', 'timeoutMs', 'condition']],
  ['status', ['sessionId']],
  ['follow_up', ['sessionId', 'text']],
  ['report', ['target', 'text']],
  ['delegation_submit', ['delegationId', 'summary']],
  ['delegations_read', ['delegationId']],
  ['delegation_accept', ['delegationId', 'submissionRevision']],
  ['delegation_request_revision', ['delegationId', 'submissionRevision', 'feedback']],
])

const ACTION_DESCRIPTION =
  'help lists every action with its parameters; the others take theirs at the top level.'
const TOPIC_DESCRIPTION = 'For help: one action, to get its full parameter schema.'

export function isHotHiveAction(action: string) {
  return HOT_ACTION_PROPERTIES.has(action)
}

/**
 * A union of object shapes, such as report's `target`, as one object with every shape's
 * properties and the properties all shapes require: a looser, much shorter declaration. The
 * exact shape is still checked against the action's contract before the call runs.
 */
function mergedObjectUnion(schema: JsonSchemaObject): JsonSchemaObject {
  const { anyOf, ...rest } = schema
  const members = schemaArray(anyOf)
  if (!members || members.length === 0 || members.some((member) => member.type !== 'object')) {
    return schema
  }
  const properties = new Map<string, JsonSchemaObject[]>()
  for (const member of members) {
    for (const [key, property] of Object.entries(propertiesOf(member))) {
      if (isJsonSchemaObject(property))
        properties.set(key, [...(properties.get(key) ?? []), property])
    }
  }
  const required = requiredOf(members[0] ?? {}).filter((key) =>
    members.every((member) => requiredOf(member).includes(key)),
  )
  return {
    ...rest,
    type: 'object',
    properties: Object.fromEntries(
      [...properties].map(([key, shapes]) => [
        key,
        shapes.length === 1 ? shapes[0] : literalUnionsAsEnums({ anyOf: shapes }),
      ]),
    ),
    required,
  }
}

function plainSchema(schema: unknown) {
  // TypeBox keeps its markers non-enumerable; the provider payload is the JSON form.
  const plain: unknown = JSON.parse(JSON.stringify(schema))
  if (!isJsonSchemaObject(plain)) throw new Error('The hive tool schema is not an object.')
  return plain
}

/**
 * The hive tool's provider schema for the permitted actions: `action` lists every one of them
 * plus `help`, and only the hot actions' main properties are typed. A property shared with a
 * rarer action keeps the union of both, so declaring it never refuses the rarer action's value.
 */
export function hiveToolSchema(
  variants: readonly SessionsToolRuntimeVariant[],
): TUnsafe<SessionsToolParameters> {
  const actions = variants.flatMap((variant) => variantActionName(variant) ?? [])
  const hot = actions.filter(isHotHiveAction)
  const declared = new Set(hot.flatMap((action) => HOT_ACTION_PROPERTIES.get(action) ?? []))
  const flat = plainSchema(
    flattenSessionsToolParameters(variants, {
      declaredProperties: declared,
      requiredNoteActions: new Set(hot),
    }),
  )
  const { action: _action, ...declaredProperties } = propertiesOf(flat)
  const properties = Object.fromEntries(
    Object.entries(declaredProperties).map(([key, property]) => [
      key,
      isJsonSchemaObject(property) ? mergedObjectUnion(property) : property,
    ]),
  )
  return Type.Unsafe<SessionsToolParameters>(
    literalUnionsAsEnums({
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [...actions, HIVE_HELP_ACTION],
          description: ACTION_DESCRIPTION,
        },
        ...properties,
        topic: { type: 'string', description: TOPIC_DESCRIPTION },
      },
      required: ['action'],
    }),
  )
}

/** One action's complete parameter schema, with its required properties, as `help` returns it. */
export function hiveActionSchema(variant: SessionsToolRuntimeVariant) {
  return literalUnionsAsEnums(plainSchema(variant))
}
