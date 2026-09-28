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

const REFERENCE_KEYWORD = /"\$(?:ref|dynamicRef|recursiveRef)"/u

/** A local JSON pointer's decoded segments whose target moved, and where it moved to. */
type PointerMove = readonly [from: readonly string[], to: readonly string[]]

/** Schema keywords whose values are instance data, not subschemas. */
const DATA_KEYWORDS = new Set(['const', 'enum', 'default', 'examples'])
/** Schema keywords whose values map names (which can be any string) to subschemas. */
const SCHEMA_MAP_KEYWORDS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
])

/**
 * Whether anything below the root declares a string `$id`, which rebases its local references.
 * Data values are searched too: a false positive only drops hoisted `required` guidance.
 */
function hasNestedResource(value: unknown, root = true): boolean {
  if (Array.isArray(value)) return value.some((item) => hasNestedResource(item, false))
  if (!isJsonSchemaObject(value)) return false
  if (!root && typeof value.$id === 'string') return true
  return Object.values(value).some((entry) => hasNestedResource(entry, false))
}

/** RFC 6901 escaping, then URI fragment encoding (`$` stays readable, as in `$defs`). */
function encodePointerSegment(segment: string) {
  return encodeURIComponent(segment.replaceAll('~', '~0').replaceAll('/', '~1')).replaceAll(
    '%24',
    '$',
  )
}

const LOCAL_POINTER_PREFIX = '#/'

/** RFC 6901 §6: percent-decode the fragment first, then split, then unescape `~1` and `~0`. */
function decodedPointer(reference: string) {
  if (!reference.startsWith(LOCAL_POINTER_PREFIX)) return undefined
  try {
    return decodeURIComponent(reference.slice(LOCAL_POINTER_PREFIX.length))
      .split('/')
      .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
  } catch {
    return undefined
  }
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
  const base = ['properties', key]
  const moves: PointerMove[] = isBareUnion
    ? alternatives.map((_, index) => [
        [...base, 'anyOf', String(index)],
        [...base, 'anyOf', String(index + offset)],
      ])
    : [[base, [...base, 'anyOf', String(offset)]]]
  const wrapper = {
    ...(description === undefined ? {} : { description }),
    anyOf: offset === 1 ? [{}, ...alternatives] : [...alternatives, {}],
  }
  return { wrapper, moves: moves.filter(([from, to]) => from.join('/') !== to.join('/')) }
}

function movedReference(reference: string, moves: readonly PointerMove[]) {
  const segments = decodedPointer(reference)
  if (!segments) return reference
  for (const [from, to] of moves) {
    if (from.every((segment, index) => segments[index] === segment)) {
      return `${LOCAL_POINTER_PREFIX}${[...to, ...segments.slice(from.length)].map(encodePointerSegment).join('/')}`
    }
  }
  return reference
}

/**
 * Rewrites local `$ref`s that pointed into a definition the relaxation moved. Instance data
 * (`const`, `enum`, ...) is left alone, and a subschema with its own `$id` resolves `#` against
 * itself, so its references are left alone too. `position` tells a schema from a name map.
 */
function followMoves(
  value: unknown,
  moves: readonly PointerMove[],
  position: 'root' | 'schema' | 'map' = 'root',
): unknown {
  if (Array.isArray(value)) return value.map((item) => followMoves(item, moves, 'schema'))
  if (!isJsonSchemaObject(value)) return value
  if (position === 'map') {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [name, followMoves(entry, moves, 'schema')]),
    )
  }
  if (position === 'schema' && typeof value.$id === 'string') return value
  return Object.fromEntries(
    Object.entries(value).map(([keyword, entry]) => [
      keyword,
      followKeyword(keyword, entry, moves),
    ]),
  )
}

function followKeyword(keyword: string, entry: unknown, moves: readonly PointerMove[]) {
  if (keyword === '$ref' && typeof entry === 'string') return movedReference(entry, moves)
  if (DATA_KEYWORDS.has(keyword)) return entry
  return followMoves(entry, moves, SCHEMA_MAP_KEYWORDS.has(keyword) ? 'map' : 'schema')
}

/**
 * Pi validates every call against the provider-facing parameters (`validateToolArguments`)
 * before the tool runs, so a repaired schema that is stricter than the server's blocks valid
 * calls before call-time validation is consulted. A flattened schema can be stricter: an
 * alternative may admit a property through `patternProperties`, a hoisted `$ref` may point into
 * a removed combinator, a merged definition may be narrower than another alternative's, and a
 * root keyword may have coerced or admitted a value. So the relaxed schema asserts only the
 * object root and the fields every accepted argument carries; each property keeps its
 * definitions as model guidance beside a permissive alternative. Any repair can be stricter
 * (a dropped `if` can hide annotations `unevaluatedProperties` relied on, a set root `type`
 * reaches `{ $ref: '#' }`), so relax every repaired schema that is validated against the server
 * schema at call time, since that is then the only check before approval.
 */
export function relaxForPreCallValidation(
  schema: MutableJsonSchema,
  serverSchema: Readonly<Record<string, unknown>>,
  repairs: string[],
) {
  const relaxed: MutableJsonSchema = {}
  for (const [keyword, value] of Object.entries(schema)) {
    if (RELAXED_ROOT_KEYWORDS.has(keyword)) relaxed[keyword] = value
    else repairs.push(`relaxed root ${keyword}; enforced by the server schema when the tool runs`)
  }
  // Flattening resolves every local `$ref` against the document root, which misreads references
  // inside a nested `$id` resource, so only the server root's own `required` is certain then.
  if (hasNestedResource(serverSchema)) {
    const declared: unknown = serverSchema.required
    const required = Array.isArray(declared)
      ? declared.filter((key): key is string => typeof key === 'string')
      : []
    if (required.length > 0) relaxed.required = required
    else delete relaxed.required
    repairs.push("kept only the root's own required fields; nested $id resources")
  }
  const properties = isJsonSchemaObject(schema.properties) ? schema.properties : {}
  if (Object.keys(properties).length === 0) return relaxed
  const guided = Object.entries(properties).map(([key, definition]) =>
    // `true` and `{}` already accept any value; wrapping them would only add noise.
    definition === true || (isJsonSchemaObject(definition) && Object.keys(definition).length === 0)
      ? ([key, { wrapper: definition, moves: [] }] as const)
      : ([key, guidanceOnlyProperty(key, definition)] as const),
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
