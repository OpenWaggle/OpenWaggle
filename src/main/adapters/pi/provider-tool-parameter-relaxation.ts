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

/** Whether any subschema below the root declares `$id`, which rebases its local references. */
function hasNestedResource(value: unknown, root = true): boolean {
  if (Array.isArray(value)) return value.some((item) => hasNestedResource(item, false))
  if (!isJsonSchemaObject(value)) return false
  if (!root && typeof value.$id === 'string') return true
  return Object.values(value).some((entry) => hasNestedResource(entry, false))
}

function encodePointerSegment(segment: string) {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1').replaceAll('%', '%25')
}

const LOCAL_POINTER_PREFIX = '#/'

function decodedPointer(reference: string) {
  if (!reference.startsWith(LOCAL_POINTER_PREFIX)) return undefined
  try {
    return reference
      .slice(LOCAL_POINTER_PREFIX.length)
      .split('/')
      .map((segment) => decodeURIComponent(segment).replaceAll('~1', '/').replaceAll('~0', '~'))
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
 * Rewrites local `$ref`s that pointed into a definition the relaxation moved. A subschema with
 * its own `$id` resolves `#` against itself, so its references are left alone.
 */
function followMoves(value: unknown, moves: readonly PointerMove[], root = true): unknown {
  if (Array.isArray(value)) return value.map((item) => followMoves(item, moves, false))
  if (!isJsonSchemaObject(value)) return value
  if (!root && typeof value.$id === 'string') return value
  return Object.fromEntries(
    Object.entries(value).map(([keyword, entry]) => [
      keyword,
      keyword === '$ref' && typeof entry === 'string'
        ? movedReference(entry, moves)
        : followMoves(entry, moves, false),
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
