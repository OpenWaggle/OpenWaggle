import { JSONSchema, Schema } from 'effect'
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import type { ParseOptions } from 'effect/SchemaAST'

/**
 * How an MCP tool or prompt schema decodes a call: every issue is reported, each with its field
 * path, and a key the schema does not declare is refused, as `additionalProperties: false` in the
 * advertised JSON Schema says.
 */
export const MCP_SCHEMA_PARSE_OPTIONS = {
  errors: 'all',
  onExcessProperty: 'error',
} as const satisfies ParseOptions

const JSON_SCHEMA_TARGETS = {
  'draft-2020-12': 'jsonSchema2020-12',
  'draft-07': 'jsonSchema7',
} as const

function effectTarget(target: string) {
  if (target === 'draft-2020-12' || target === 'draft-07') return JSON_SCHEMA_TARGETS[target]
  throw new Error(`Effect Schema cannot describe a tool schema as ${target} JSON Schema.`)
}

function jsonSchemaFor(schema: Schema.Schema.AnyNoContext, target: string) {
  return { ...JSONSchema.make(schema, { target: effectTarget(target) }) }
}

function cachedJsonSchema(schema: Schema.Schema.AnyNoContext) {
  const generated = new Map<string, ReturnType<typeof jsonSchemaFor>>()
  return ({ target }: { readonly target: string }) => {
    const cached = generated.get(target)
    if (cached) return cached
    const jsonSchema = jsonSchemaFor(schema, target)
    generated.set(target, jsonSchema)
    return jsonSchema
  }
}

/**
 * An Effect Schema as the MCP SDK's `StandardSchemaWithJSON`: Standard Schema validation from
 * `Schema.standardSchemaV1` and Standard JSON Schema from `JSONSchema.make`: the input side is the
 * schema itself, which JSON Schema describes from its encoded side, and the output side its
 * `Schema.typeSchema`. Handler arguments are `Schema.Type`.
 */
export function standardSchemaWithJson<A, I>(
  schema: Schema.Schema<A, I>,
  parseOptions: ParseOptions = MCP_SCHEMA_PARSE_OPTIONS,
) {
  const standard = Schema.standardSchemaV1(schema, parseOptions)['~standard']
  const result: StandardSchemaWithJSON<I, A> = {
    '~standard': {
      ...standard,
      jsonSchema: {
        input: cachedJsonSchema(schema),
        output: cachedJsonSchema(Schema.typeSchema(schema)),
      },
    },
  }
  return result
}

/**
 * `accepted`'s validation with `advertised`'s JSON Schema: a tool can list fewer inputs than it
 * validates, so a call outside the list reaches the handler's own, clearer refusal.
 */
export function withAdvertisedJsonSchema<I, A>(
  accepted: StandardSchemaWithJSON<I, A>,
  advertised: StandardSchemaWithJSON,
) {
  const result: StandardSchemaWithJSON<I, A> = {
    '~standard': { ...accepted['~standard'], jsonSchema: advertised['~standard'].jsonSchema },
  }
  return result
}
