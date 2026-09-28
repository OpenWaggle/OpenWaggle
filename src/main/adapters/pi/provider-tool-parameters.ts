import type { McpJsonValue } from '@shared/types/mcp'
import { type TUnsafe, Type } from 'typebox'

/**
 * Root keywords Anthropic models reject in a tool `input_schema` even when the root is
 * `type: "object"` ("input_schema does not support oneOf, allOf, or anyOf at the top
 * level"). Pi's direct Anthropic serializer rebuilds the root and hides this, but its
 * Amazon Bedrock and OpenAI serializers forward tool parameters unchanged.
 */
const UNSUPPORTED_ROOT_COMBINATORS = new Set(['anyOf', 'oneOf', 'allOf'])

type ObjectRootSchema = Readonly<Record<string, McpJsonValue>> & { readonly type: 'object' }

function isObjectRootSchema(value: McpJsonValue | undefined): value is ObjectRootSchema {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && value.type === 'object'
  )
}

/**
 * Converts an externally supplied JSON Schema (MCP tool or sampling tool) into tool
 * parameters every Pi provider serializer accepts: an object root without root-level
 * combinators. Amazon Bedrock rejects the whole request when any single tool violates
 * this, so one malformed descriptor would otherwise break every turn that carries it.
 *
 * Root combinators are dropped rather than the whole schema, keeping `properties` and
 * `required` as argument guidance; the tool's own server still validates the full
 * contract. A schema without an object root falls back to an open argument object.
 */
export function toProviderToolParameters(
  schema: McpJsonValue | undefined,
): TUnsafe<Record<string, unknown>> {
  if (!isObjectRootSchema(schema)) {
    return Type.Unsafe<Record<string, unknown>>(Type.Record(Type.String(), Type.Unknown()))
  }
  const supported = Object.fromEntries(
    Object.entries(schema).filter(([keyword]) => !UNSUPPORTED_ROOT_COMBINATORS.has(keyword)),
  )
  return Type.Unsafe<Record<string, unknown>>({ ...supported, type: 'object' })
}
