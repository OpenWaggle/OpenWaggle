import { isJsonSchemaObject, type MutableJsonSchema } from './json-schema-object'

/**
 * Root keywords a relaxed schema keeps: its object shape, what every accepted argument must
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
  '$id',
  '$defs',
  'definitions',
  'examples',
  'default',
  'deprecated',
  'readOnly',
  'writeOnly',
])

/** Root keywords whose flattening hoists definitions that can be stricter than the original. */
const RESTRUCTURED_ROOT_KEYWORDS = ['anyOf', 'oneOf', 'allOf', '$ref'] as const

const REFERENCE_KEYWORD = /"\$(?:ref|dynamicRef|recursiveRef)"/u

/** A local JSON pointer prefix whose target moved, and where it moved to. */
type PointerMove = readonly [from: string, to: string]

/**
 * Whether a repaired schema must be relaxed before Pi validates calls against it. Only merged
 * combinators and inlined references hoist definitions that can reject arguments the original
 * accepts; dropping a root `not`/`enum`/`if` or setting a missing root `type` only loosens it.
 */
export function needsRelaxation(serverSchema: Readonly<Record<string, unknown>>) {
  return RESTRUCTURED_ROOT_KEYWORDS.some((keyword) => serverSchema[keyword] !== undefined)
}

function escapePointerSegment(segment: string) {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1')
}

/** The description moves to the wrapping property, so providers receive it once. */
function withoutDescription(definition: unknown, moved: string | undefined): unknown {
  if (!isJsonSchemaObject(definition) || definition.description !== moved) return definition
  const { description: _description, ...rest } = definition
  return rest
}

/**
 * Shows the model a property's definitions next to a `{}` alternative that accepts any value,
 * and reports where the definitions moved so local `$ref`s into them can follow.
 */
function guidanceOnlyProperty(key: string, definition: unknown) {
  const description =
    isJsonSchemaObject(definition) && typeof definition.description === 'string'
      ? definition.description
      : undefined
  // A merged `{ anyOf: [...] }` gains the permissive alternative directly instead of nesting.
  const union: unknown = isJsonSchemaObject(definition) ? definition.anyOf : undefined
  const isBareUnion =
    Array.isArray(union) &&
    isJsonSchemaObject(definition) &&
    Object.keys(definition).every((field) => field === 'anyOf' || field === 'description')
  const alternatives = (isBareUnion && Array.isArray(union) ? union : [definition]).map(
    (alternative) => withoutDescription(alternative, description),
  )
  // Validators compile and check union members in order. A member with a reference compiled on
  // its own can refer to itself (`{ $ref: '#' }`) and recurse forever, so let `{}` match first.
  const offset = REFERENCE_KEYWORD.test(JSON.stringify(alternatives)) ? 1 : 0
  const base = `#/properties/${escapePointerSegment(key)}`
  const moves: PointerMove[] = isBareUnion
    ? alternatives.map((_, index) => [
        `${base}/anyOf/${String(index)}`,
        `${base}/anyOf/${String(index + offset)}`,
      ])
    : [[base, `${base}/anyOf/${String(offset)}`]]
  const wrapper = {
    ...(description === undefined ? {} : { description }),
    anyOf: offset === 1 ? [{}, ...alternatives] : [...alternatives, {}],
  }
  return { wrapper, moves: moves.filter(([from, to]) => from !== to) }
}

function movedReference(reference: string, moves: readonly PointerMove[]) {
  for (const [from, to] of moves) {
    if (reference === from || reference.startsWith(`${from}/`)) {
      return `${to}${reference.slice(from.length)}`
    }
  }
  return reference
}

/** Rewrites local `$ref`s that pointed into a definition the relaxation moved. */
function followMoves(value: unknown, moves: readonly PointerMove[]): unknown {
  if (Array.isArray(value)) return value.map((item) => followMoves(item, moves))
  if (!isJsonSchemaObject(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([keyword, entry]) => [
      keyword,
      keyword === '$ref' && typeof entry === 'string'
        ? movedReference(entry, moves)
        : followMoves(entry, moves),
    ]),
  )
}

/**
 * Pi validates every call against the provider-facing parameters (`validateToolArguments`)
 * before the tool runs, so a repaired schema that is stricter than the server's blocks valid
 * calls before call-time validation is consulted. A flattened schema can be stricter: an
 * alternative may admit a property through `patternProperties`, a hoisted `$ref` may point into
 * a removed combinator, a merged definition may be narrower than another alternative's, and a
 * root keyword may have coerced or admitted a value. So the relaxed schema asserts only the
 * object root and the fields every accepted argument carries; each property keeps its
 * definitions as model guidance beside a permissive alternative. Use it only when the tool
 * validates arguments against the server's schema at call time, since that is then the only
 * check before approval.
 */
export function relaxForPreCallValidation(schema: MutableJsonSchema, repairs: string[]) {
  const relaxed: MutableJsonSchema = {}
  for (const [keyword, value] of Object.entries(schema)) {
    if (RELAXED_ROOT_KEYWORDS.has(keyword)) relaxed[keyword] = value
    else repairs.push(`relaxed root ${keyword}; enforced by the server schema when the tool runs`)
  }
  const properties = isJsonSchemaObject(schema.properties) ? schema.properties : {}
  if (Object.keys(properties).length === 0) return relaxed
  const guided = Object.entries(properties).map(
    ([key, definition]) => [key, guidanceOnlyProperty(key, definition)] as const,
  )
  relaxed.properties = Object.fromEntries(guided.map(([key, { wrapper }]) => [key, wrapper]))
  repairs.push(
    'kept property definitions as guidance; enforced by the server schema when the tool runs',
  )
  const moves = guided.flatMap(([, guidance]) => guidance.moves)
  if (moves.length === 0) return relaxed
  const followed = followMoves(relaxed, moves)
  return isJsonSchemaObject(followed) ? { ...followed } : relaxed
}
