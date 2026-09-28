import { isMatching, P } from '@diegogbrisa/ts-match'

type JsonSchemaObject = { readonly [key: string]: unknown }
type MutableJsonSchema = { [key: string]: unknown }

function isJsonSchemaObject(value: unknown): value is JsonSchemaObject {
  return isMatching(P.record(P.string, P._), value) && !Array.isArray(value)
}

/**
 * Root keywords a repaired schema keeps: its object shape, what every accepted argument must
 * carry, and annotations. Anything else could reject an argument the original accepted.
 */
const RELAXED_ROOT_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'title',
  'description',
  '$schema',
  '$comment',
  '$defs',
  'definitions',
])

/** Shows the model a property's definitions next to a `{}` alternative that accepts any value. */
function guidanceOnlyProperty(definition: unknown) {
  const description =
    isJsonSchemaObject(definition) && typeof definition.description === 'string'
      ? definition.description
      : undefined
  // A merged `{ anyOf: [...] }` gains the permissive alternative directly instead of nesting.
  const union: unknown = isJsonSchemaObject(definition) ? definition.anyOf : undefined
  const isBareUnion =
    Array.isArray(union) &&
    isJsonSchemaObject(definition) &&
    Object.keys(definition).every((key) => key === 'anyOf' || key === 'description')
  const alternatives: readonly unknown[] =
    isBareUnion && Array.isArray(union) ? union : [definition]
  return { ...(description === undefined ? {} : { description }), anyOf: [...alternatives, {}] }
}

/**
 * Pi validates every call against the provider-facing parameters (`validateToolArguments`)
 * before the tool runs, so a repaired schema that is stricter than the original blocks valid
 * calls before the server schema is ever consulted. A flattened schema can be stricter: an
 * alternative may admit a property through `patternProperties`, a hoisted `$ref` may point into
 * a removed combinator, a merged definition may be narrower than another alternative's, and a
 * root keyword may have coerced or admitted a value. So the repaired schema asserts only the
 * object root and the fields every accepted argument carries; each property keeps its
 * definitions as model guidance beside a permissive alternative, and the full server schema is
 * still enforced when the tool runs.
 */
export function relaxForPreCallValidation(schema: MutableJsonSchema, repairs: string[]) {
  const relaxed: MutableJsonSchema = {}
  for (const [keyword, value] of Object.entries(schema)) {
    if (RELAXED_ROOT_KEYWORDS.has(keyword)) relaxed[keyword] = value
    else repairs.push(`relaxed root ${keyword}; enforced when the tool runs`)
  }
  const properties = isJsonSchemaObject(schema.properties) ? schema.properties : {}
  if (Object.keys(properties).length > 0) {
    relaxed.properties = Object.fromEntries(
      Object.entries(properties).map(([key, definition]) => [
        key,
        guidanceOnlyProperty(definition),
      ]),
    )
    repairs.push('kept property definitions as guidance; enforced when the tool runs')
  }
  return relaxed
}
