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
const MEMBER_COMBINATORS = ['allOf', 'anyOf', 'oneOf'] as const

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

/**
 * Hoists combinator members' properties to the root so the model keeps its argument
 * guidance. Root definitions win. Only `allOf` members contribute required fields; an
 * `anyOf`/`oneOf` member's fields are required only for that alternative.
 */
function hoistMemberProperties(schema: ObjectRootSchema) {
  const rootProperties = schema.properties
  const properties: Record<string, McpJsonValue> = isJsonObject(rootProperties)
    ? { ...rootProperties }
    : {}
  const required = new Set(stringList(schema.required))
  for (const combinator of MEMBER_COMBINATORS) {
    for (const member of objectMembers(schema[combinator])) {
      const memberProperties = member.properties
      if (isJsonObject(memberProperties)) {
        for (const [name, definition] of Object.entries(memberProperties)) {
          if (!(name in properties)) properties[name] = definition
        }
      }
      if (combinator === 'allOf') {
        for (const name of stringList(member.required)) required.add(name)
      }
    }
  }
  return { properties, required: [...required] }
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
 * result is looser than the original; the tool's own server still validates the full
 * contract. A schema without an object root falls back to an open argument object.
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
