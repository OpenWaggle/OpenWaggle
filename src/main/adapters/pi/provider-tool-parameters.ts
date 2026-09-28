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

/** Root annotations kept on a rewritten schema; every other root assertion is dropped. */
const KEPT_ROOT_ANNOTATIONS = new Set(['title', 'description', '$comment', '$defs', 'definitions'])

const ALTERNATIVE_COMBINATORS = ['anyOf', 'oneOf'] as const

function isJsonObject(value: McpJsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isObjectRootSchema(value: McpJsonValue | undefined): value is ObjectRootSchema {
  return isJsonObject(value) && value.type === 'object'
}

function arrayValue(value: McpJsonValue | undefined) {
  return Array.isArray(value) ? value : []
}

function stringList(value: McpJsonValue | undefined) {
  return arrayValue(value).filter((entry): entry is string => typeof entry === 'string')
}

function propertyEntries(schema: McpJsonValue) {
  const properties = isJsonObject(schema) ? schema.properties : undefined
  return isJsonObject(properties) ? Object.entries(properties) : []
}

/**
 * Fields every argument the original schema accepts must carry: the root's and each
 * `allOf` member's `required`, plus, per `anyOf`/`oneOf`, the fields every alternative
 * requires (any accepted argument satisfies at least one alternative).
 */
function guaranteedRequired(schema: ObjectRootSchema) {
  const required = new Set(stringList(schema.required))
  for (const member of arrayValue(schema.allOf)) {
    if (isJsonObject(member)) for (const name of stringList(member.required)) required.add(name)
  }
  for (const combinator of ALTERNATIVE_COMBINATORS) {
    const members = arrayValue(schema[combinator])
    if (members.length === 0 || !members.every(isJsonObject)) continue
    const [first, ...rest] = members.map((member) => new Set(stringList(member.required)))
    for (const name of first ?? []) {
      if (rest.every((names) => names.has(name))) required.add(name)
    }
  }
  return [...required]
}

/**
 * Every definition the schema gives each property, from the root, `allOf` members and
 * `anyOf`/`oneOf` alternatives, deduplicated by content.
 */
function propertyDefinitions(schema: ObjectRootSchema) {
  const definitions = new Map<string, Map<string, McpJsonValue>>()
  const sources = [
    schema,
    ...arrayValue(schema.allOf),
    ...ALTERNATIVE_COMBINATORS.flatMap((combinator) => arrayValue(schema[combinator])),
  ]
  for (const source of sources) {
    for (const [name, definition] of propertyEntries(source)) {
      const distinct = definitions.get(name) ?? new Map<string, McpJsonValue>()
      distinct.set(JSON.stringify(definition), definition)
      definitions.set(name, distinct)
    }
  }
  return definitions
}

/**
 * A property schema that shows the model each original definition but accepts any value.
 * The `{}` alternative is what guarantees the rewrite never rejects an argument the
 * original accepted: an alternative may not apply to a given argument, a `$ref` may point
 * into a removed keyword, and root keywords that coerced or admitted the value are gone.
 */
function guidanceOnly(definitions: readonly McpJsonValue[]): McpJsonValue {
  const described = definitions.find(
    (definition) => isJsonObject(definition) && typeof definition.description === 'string',
  )
  const description = isJsonObject(described) ? described.description : undefined
  return {
    ...(typeof description === 'string' ? { description } : {}),
    anyOf: [...definitions, {}],
  }
}

/**
 * Converts an externally supplied JSON Schema (MCP tool or sampling tool) into tool
 * parameters Pi's provider serializers can send: an object root without the root
 * keywords above. One violating tool makes Amazon Bedrock or OpenAI reject the whole
 * request, which would otherwise break every turn that carries the tool.
 *
 * Provider-safe schemas pass through unchanged. Otherwise Pi validates calls against the
 * rewrite before execute (`validateToolArguments`), so it must never reject an argument
 * the original accepted. The rewrite therefore asserts only an object root and the fields
 * every accepted argument carries; each property keeps its original definitions as model
 * guidance next to a permissive alternative. The tool's own server still validates the
 * full contract. A schema without an object root falls back to an open argument object.
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
  const properties = Object.fromEntries(
    [...propertyDefinitions(schema)].map(([name, distinct]) => [
      name,
      guidanceOnly([...distinct.values()]),
    ]),
  )
  const required = guaranteedRequired(schema)
  const annotations = Object.fromEntries(
    Object.entries(schema).filter(([keyword]) => KEPT_ROOT_ANNOTATIONS.has(keyword)),
  )
  return Type.Unsafe<Record<string, unknown>>({
    ...annotations,
    type: 'object',
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    ...(required.length > 0 ? { required } : {}),
  })
}
