import { isJsonSchemaObject, type JsonSchemaObject, keywordsOf } from './json-schema-object'

/** Keywords a string choice may carry besides `const` or `enum`. */
const CHOICE_ANNOTATIONS = new Set(['type', 'description', 'const', 'enum'])

function stringValues(values: unknown) {
  if (!Array.isArray(values)) return undefined
  const strings = values.filter((value): value is string => typeof value === 'string')
  return strings.length === values.length ? strings : undefined
}

/** The strings a union member allows when it is a plain string `const` or `enum`. */
function stringChoices(member: unknown) {
  if (!isJsonSchemaObject(member)) return undefined
  const { type, const: constant, enum: choices } = keywordsOf(member)
  if (type !== undefined && type !== 'string') return undefined
  if (Object.keys(member).some((key) => !CHOICE_ANNOTATIONS.has(key))) return undefined
  if (typeof constant === 'string' && choices === undefined) return [constant]
  if (constant === undefined) return stringValues(choices)
  return undefined
}

function compactNode(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(compactNode)
  if (!isJsonSchemaObject(schema)) return schema
  const compacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) compacted[key] = compactNode(value)
  const { anyOf, ...rest } = compacted
  if (!Array.isArray(anyOf) || anyOf.length === 0) return compacted
  const choices = anyOf.map(stringChoices)
  if (choices.some((choice) => choice === undefined)) return compacted
  const values = [...new Set(choices.flatMap((choice) => choice ?? []))]
  return { ...rest, type: 'string', enum: values }
}

/**
 * The same JSON Schema with every union of plain string literals (TypeBox `Union(Literal…)`,
 * serialized as `anyOf: [{ type: "string", const: … }]`) written as one `enum`. It accepts the same
 * values and is about a fifth smaller in a tool declaration (C6 of the v1 performance research).
 * Unions with any other member, such as `null` or an object, are kept.
 */
export function literalUnionsAsEnums(schema: JsonSchemaObject) {
  const compacted = compactNode(schema)
  return isJsonSchemaObject(compacted) ? compacted : schema
}
