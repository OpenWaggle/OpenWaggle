import type { McpJsonValue } from '@shared/types/mcp'
import { type TUnsafe, Type } from 'typebox'

type JsonObject = Readonly<Record<string, McpJsonValue>>
type ObjectRootSchema = JsonObject & { readonly type: 'object' }

/**
 * Root keywords providers reject in a tool schema even beside `type: "object"`:
 * - Claude, including on Amazon Bedrock: "input_schema does not support oneOf, allOf, or
 *   anyOf at the top level".
 * - OpenAI: "schema must have type 'object' and not have
 *   'oneOf'/'anyOf'/'allOf'/'enum'/'const'/'not' at the top level".
 * Pi's direct Anthropic serializer rebuilds the root and hides this, but its Bedrock and
 * OpenAI serializers forward tool parameters unchanged.
 */
const UNSUPPORTED_ROOT_KEYWORDS = new Set(['anyOf', 'oneOf', 'allOf', 'enum', 'const', 'not'])
const ALTERNATIVE_COMBINATORS = ['anyOf', 'oneOf'] as const

function isJsonObject(value: McpJsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isObjectRootSchema(value: McpJsonValue | undefined): value is ObjectRootSchema {
  return isJsonObject(value) && value.type === 'object'
}

function objectMembers(value: McpJsonValue | undefined) {
  return Array.isArray(value) ? value.filter(isJsonObject) : []
}

function stringList(value: McpJsonValue | undefined) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function memberProperties(member: JsonObject) {
  const properties = member.properties
  return isJsonObject(properties) ? Object.entries(properties) : []
}

function memberPropertyNames(member: JsonObject) {
  return memberProperties(member).map(([name]) => name)
}

// A definition referencing into a removed root keyword (for example
// `#/anyOf/0/$defs/Item`) would dangle once that keyword is stripped.
const REMOVED_KEYWORD_REFERENCE = /"\$ref":"#\/(?:anyOf|oneOf|allOf|enum|const|not)(?:\/|")/u

function hoistable(definition: McpJsonValue): McpJsonValue {
  if (!REMOVED_KEYWORD_REFERENCE.test(JSON.stringify(definition))) return definition
  const description = isJsonObject(definition) ? definition.description : undefined
  return typeof description === 'string' ? { description } : {}
}

/**
 * What one `anyOf`/`oneOf` alternative allows for a property: its own definition, nothing
 * when the alternative is closed, or anything (`{}`) when the alternative leaves the
 * property unconstrained, which keeps the hoisted schema from rejecting arguments that
 * alternative accepted.
 */
function alternativeDefinition(member: McpJsonValue, name: string): McpJsonValue | undefined {
  if (!isJsonObject(member)) return {}
  const properties = member.properties
  const definition = isJsonObject(properties) ? properties[name] : undefined
  if (definition !== undefined) return hoistable(definition)
  return member.additionalProperties === false ? undefined : {}
}

/**
 * Hoists combinator members' properties to the root so the model keeps its argument
 * guidance, without rejecting any argument the original schema accepted:
 * - Root and `allOf` definitions apply to every valid argument, so the first of them wins
 *   and `allOf` members contribute required fields.
 * - `anyOf`/`oneOf` members are alternatives. A property they define differently (a
 *   discriminator such as `kind: {const: 'a'}` vs `{const: 'b'}`), or that some
 *   alternative leaves unconstrained, becomes a nested `anyOf` of what each alternative
 *   allows, which providers accept below the root. Their required fields apply only to
 *   that alternative and are not hoisted.
 */
function hoistMemberProperties(schema: ObjectRootSchema) {
  const rootProperties = schema.properties
  const properties: Record<string, McpJsonValue> = isJsonObject(rootProperties)
    ? Object.fromEntries(
        Object.entries(rootProperties).map(([name, definition]) => [name, hoistable(definition)]),
      )
    : {}
  const required = new Set(stringList(schema.required))
  for (const member of objectMembers(schema.allOf)) {
    for (const [name, definition] of memberProperties(member)) {
      if (!Object.hasOwn(properties, name)) properties[name] = hoistable(definition)
    }
    for (const name of stringList(member.required)) required.add(name)
  }
  for (const [name, definitions] of alternativeDefinitions(schema, properties)) {
    properties[name] =
      definitions.length === 1 ? (definitions[0] ?? {}) : { anyOf: [...definitions] }
  }
  return { properties, required: [...required] }
}

/** Distinct definitions each `anyOf`/`oneOf` alternative allows, per not-yet-defined name. */
function alternativeDefinitions(
  schema: ObjectRootSchema,
  defined: Readonly<Record<string, McpJsonValue>>,
) {
  const alternatives = new Map<string, Map<string, McpJsonValue>>()
  for (const combinator of ALTERNATIVE_COMBINATORS) {
    const combinatorValue = schema[combinator]
    const members = Array.isArray(combinatorValue) ? combinatorValue : []
    const names = new Set(members.filter(isJsonObject).flatMap(memberPropertyNames))
    for (const name of names) {
      if (Object.hasOwn(defined, name)) continue
      const distinct = alternatives.get(name) ?? new Map<string, McpJsonValue>()
      for (const member of members) {
        const candidate = alternativeDefinition(member, name)
        if (candidate !== undefined) distinct.set(JSON.stringify(candidate), candidate)
      }
      alternatives.set(name, distinct)
    }
  }
  return [...alternatives].map(([name, distinct]) => [name, [...distinct.values()]] as const)
}

/**
 * Converts an externally supplied JSON Schema (MCP tool or sampling tool) into tool
 * parameters Pi's provider serializers can send: an object root without the root
 * keywords above. One violating tool makes Amazon Bedrock or OpenAI reject the whole
 * request, which would otherwise break every turn that carries the tool.
 *
 * Only the unsupported root keywords are removed. Their members' properties are hoisted
 * so the model keeps argument guidance, and `unevaluatedProperties` is dropped because
 * it would otherwise reject properties the removed combinators used to evaluate. The
 * result accepts every argument the original accepted (it may accept more); the tool's
 * own server still validates the full contract. A schema without an object root falls
 * back to an open argument object.
 */
export function toProviderToolParameters(
  schema: McpJsonValue | undefined,
): TUnsafe<Record<string, unknown>> {
  if (!isObjectRootSchema(schema)) {
    return Type.Unsafe<Record<string, unknown>>(Type.Record(Type.String(), Type.Unknown()))
  }
  if (!Object.keys(schema).some((keyword) => UNSUPPORTED_ROOT_KEYWORDS.has(keyword))) {
    return Type.Unsafe<Record<string, unknown>>(schema)
  }
  const { properties, required } = hoistMemberProperties(schema)
  const supported = Object.fromEntries(
    Object.entries(schema).filter(
      ([keyword]) =>
        !UNSUPPORTED_ROOT_KEYWORDS.has(keyword) &&
        keyword !== 'unevaluatedProperties' &&
        keyword !== 'properties' &&
        keyword !== 'required',
    ),
  )
  return Type.Unsafe<Record<string, unknown>>({
    ...supported,
    type: 'object',
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    ...(required.length > 0 ? { required } : {}),
  })
}
