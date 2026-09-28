import {
  isJsonSchemaObject,
  type JsonSchemaObject,
  type MutableJsonSchema,
  propertiesOf,
  requiredOf,
  schemaArray,
} from './json-schema-object'

export { isJsonSchemaObject } from './json-schema-object'

/**
 * Root keywords at least one supported provider rejects. Bedrock (and Anthropic) require
 * `type: "object"` and reject root `anyOf`/`oneOf`/`allOf`; OpenAI function parameters must be
 * `type: "object"` and must not use `oneOf`/`anyOf`/`allOf`/`enum`/`not` at the top level. A root
 * `$ref`, `const`, or conditional hides the object shape from both.
 */
const ROOT_FORBIDDEN_KEYWORDS = [
  'anyOf',
  'oneOf',
  'allOf',
  'not',
  'enum',
  'const',
  '$ref',
  'if',
  'then',
  'else',
] as const
const ROOT_DROPPED_KEYWORDS = ['not', 'enum', 'const', 'if', 'then', 'else'] as const
const ALTERNATIVE_KEYWORDS = ['anyOf', 'oneOf'] as const
const MAX_REFERENCE_DEPTH = 16
/** Bounds flattening `{ anyOf: [{ $ref: '#' }, ...] }`, which otherwise recurses without end. */
const MAX_FLATTEN_DEPTH = 4
const MAX_FLATTENED_SCHEMAS = 256
const LOCAL_POINTER_PREFIX = '#/'

/** Why a provider would reject `schema` as a tool's parameters; empty when every provider accepts it. */
export function providerToolSchemaViolations(schema: unknown): string[] {
  if (!isJsonSchemaObject(schema)) return ['root schema is not a JSON object']
  const violations: string[] = []
  if (schema.type !== 'object') {
    violations.push(`root type is ${JSON.stringify(schema.type) ?? 'missing'}, expected "object"`)
  }
  for (const keyword of ROOT_FORBIDDEN_KEYWORDS) {
    if (schema[keyword] !== undefined) violations.push(`root declares ${keyword}`)
  }
  if (schema.properties !== undefined && !isJsonSchemaObject(schema.properties)) {
    violations.push('root properties is not an object')
  }
  return violations
}

export interface ProviderToolParameters {
  /** A schema every provider accepts: an object root without root combinators or references. */
  readonly schema: JsonSchemaObject
  /** What was changed to get there; empty when the input already conformed and is returned as is. */
  readonly repairs: readonly string[]
}

function resolvePointer(
  document: JsonSchemaObject,
  reference: string,
): JsonSchemaObject | undefined {
  if (reference === '#') return document
  if (!reference.startsWith(LOCAL_POINTER_PREFIX)) return undefined
  let current: unknown = document
  for (const rawSegment of reference.slice(LOCAL_POINTER_PREFIX.length).split('/')) {
    const segment = decodeURIComponent(rawSegment).replaceAll('~1', '/').replaceAll('~0', '~')
    if (!isJsonSchemaObject(current)) return undefined
    current = current[segment]
  }
  return isJsonSchemaObject(current) ? current : undefined
}

/** Replaces a root `$ref` with the local definition it names, keeping sibling keywords. */
function inlineReference(
  node: JsonSchemaObject,
  document: JsonSchemaObject,
  repairs: string[],
  depth = 0,
): JsonSchemaObject {
  const reference = node.$ref
  if (typeof reference !== 'string') return node
  const { $ref: _reference, ...siblings } = node
  // A nested `$id` rebases local references to that resource; document-root resolution misreads them.
  const rebased = node !== document && typeof node.$id === 'string'
  const target =
    !rebased && depth < MAX_REFERENCE_DEPTH ? resolvePointer(document, reference) : undefined
  if (!target) {
    repairs.push(`dropped unresolvable root $ref ${reference}`)
    return siblings
  }
  repairs.push(`inlined root $ref ${reference}`)
  // The inlined resource's `$id` must not become the base of the flattened root.
  const { $id: _id, ...inlined } = inlineReference(target, document, repairs, depth + 1)
  return { ...inlined, ...siblings }
}

function isObjectShaped(schema: JsonSchemaObject) {
  const type = schema.type
  if (type === undefined) return true
  if (type === 'object') return true
  return Array.isArray(type) && type.includes('object')
}

function withoutDuplicates(schemas: readonly unknown[]) {
  const seen = new Set<string>()
  return schemas.filter((schema) => {
    const key = JSON.stringify(schema)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** A short, model-readable summary of one alternative: what it requires and what it pins. */
function describeAlternative(schema: JsonSchemaObject) {
  const pinned = Object.entries(propertiesOf(schema)).flatMap(([key, property]) =>
    isJsonSchemaObject(property) && property.const !== undefined
      ? [`${key}=${JSON.stringify(property.const)}`]
      : [],
  )
  const required = requiredOf(schema)
  const parts = [
    ...(pinned.length > 0 ? [pinned.join(', ')] : []),
    required.length > 0 ? `requires ${required.join(', ')}` : 'requires nothing',
  ]
  return parts.join('; ')
}

/** The root being assembled: its own keywords plus the properties and requirements merged into it. */
interface FlatRoot {
  readonly result: MutableJsonSchema
  readonly properties: MutableJsonSchema
  readonly required: Set<string>
}

interface FlattenLimits {
  readonly depth: number
  /** Schemas left to flatten across the whole call, shared by every level. */
  readonly budget: { remaining: number }
}

function flattenMembers(
  members: readonly JsonSchemaObject[],
  document: JsonSchemaObject,
  repairs: string[],
  limits: FlattenLimits,
) {
  const nested = { depth: limits.depth + 1, budget: limits.budget }
  return members.map((member) =>
    flattenRoot(inlineReference(member, document, repairs), document, repairs, nested),
  )
}

function mergeConjunction(root: FlatRoot, members: readonly MutableJsonSchema[]) {
  for (const member of members) {
    // A property constrained twice keeps the first constraint; the full schema is enforced at run time.
    for (const [key, property] of Object.entries(propertiesOf(member))) {
      if (!(key in root.properties)) root.properties[key] = property
    }
    for (const key of requiredOf(member)) root.required.add(key)
    if (root.result.description === undefined && typeof member.description === 'string') {
      root.result.description = member.description
    }
  }
}

/** Only what every alternative requires can be required once they share one object. */
function requiredByEvery(alternatives: readonly MutableJsonSchema[]) {
  const [first, ...others] = alternatives
  return (first ? requiredOf(first) : []).filter((key) =>
    others.every((alternative) => requiredOf(alternative).includes(key)),
  )
}

function mergeAlternatives(
  root: FlatRoot,
  alternatives: readonly MutableJsonSchema[],
  hasUnconstrainedAlternative: boolean,
) {
  const occurrences = new Map<string, unknown[]>()
  for (const alternative of alternatives) {
    for (const [key, property] of Object.entries(propertiesOf(alternative))) {
      occurrences.set(key, [...(occurrences.get(key) ?? []), property])
    }
  }
  for (const [key, schemas] of occurrences) {
    if (key in root.properties) continue
    const distinct = withoutDuplicates(schemas)
    root.properties[key] = distinct.length === 1 ? distinct[0] : { anyOf: distinct }
  }
  // A `true` alternative accepts any object: nothing is then required or closed by every one.
  const constrained = hasUnconstrainedAlternative ? [] : alternatives
  for (const key of requiredByEvery(constrained)) root.required.add(key)
  const allClosed =
    constrained.length > 0 &&
    constrained.every((alternative) => alternative.additionalProperties === false)
  if (root.result.additionalProperties === undefined && allClosed) {
    root.result.additionalProperties = false
  }
  const note = alternativesNote(alternatives, hasUnconstrainedAlternative)
  const description = root.result.description
  root.result.description = typeof description === 'string' ? `${description}\n\n${note}` : note
}

/** Tells the model which shapes the flattened alternatives had, since the schema no longer does. */
function alternativesNote(
  alternatives: readonly MutableJsonSchema[],
  hasUnconstrainedAlternative: boolean,
) {
  const described = [
    ...alternatives.map(describeAlternative),
    ...(hasUnconstrainedAlternative ? ['any object'] : []),
  ]
  const shapes = described.map((shape, index) => `${String(index + 1)}) ${shape}`).join('; ')
  return `Arguments take one of ${String(described.length)} shapes, checked when the tool runs: ${shapes}.`
}

function flattenRoot(
  node: JsonSchemaObject,
  document: JsonSchemaObject,
  repairs: string[],
  limits: FlattenLimits = { depth: 0, budget: { remaining: MAX_FLATTENED_SCHEMAS } },
): MutableJsonSchema {
  const { anyOf: _anyOf, oneOf: _oneOf, allOf, ...rest } = node
  // A member referencing an ancestor (`{ anyOf: [{ $ref: '#' }] }`) would recurse forever.
  // Dropping the combinators there only loosens the schema; call-time validation is exact.
  limits.budget.remaining -= 1
  if (limits.depth >= MAX_FLATTEN_DEPTH || limits.budget.remaining < 0) {
    repairs.push('stopped flattening recursive root combinators')
    return { ...rest }
  }
  const root: FlatRoot = {
    result: { ...rest },
    properties: { ...propertiesOf(node) },
    required: new Set(requiredOf(node)),
  }
  const conjunction = schemaArray(allOf)
  if (conjunction) {
    mergeConjunction(root, flattenMembers(conjunction, document, repairs, limits))
    repairs.push(`merged root allOf of ${String(conjunction.length)} schemas`)
  }
  for (const keyword of ALTERNATIVE_KEYWORDS) {
    const members = schemaArray(node[keyword])
    if (!members) continue
    const raw = node[keyword]
    const hasUnconstrainedAlternative = Array.isArray(raw) && raw.includes(true)
    mergeAlternatives(
      root,
      flattenMembers(members, document, repairs, limits).filter(isObjectShaped),
      hasUnconstrainedAlternative,
    )
    const count = Array.isArray(raw) ? raw.length : members.length
    repairs.push(`flattened root ${keyword} of ${String(count)} schemas`)
  }
  const { result, properties, required } = root
  if (Object.keys(properties).length > 0 || result.properties !== undefined) {
    result.properties = properties
  }
  if (required.size > 0) result.required = [...required]
  else delete result.required
  return result
}

/**
 * Turns any JSON Schema into tool parameters every provider accepts, keeping as much of its
 * meaning as an object root can carry. Callers that repaired a schema must still validate
 * arguments against the original. The result can also reject some arguments the original
 * accepts, so callers that let Pi validate calls against it relax it first
 * (`provider-tool-parameter-relaxation.ts`).
 */
export function providerToolParameters(schema: unknown): ProviderToolParameters {
  if (isJsonSchemaObject(schema) && providerToolSchemaViolations(schema).length === 0) {
    return { schema, repairs: [] }
  }
  if (!isJsonSchemaObject(schema)) {
    return {
      schema: { type: 'object', properties: {} },
      repairs: [
        schema === undefined
          ? 'no input schema; accepts any object'
          : `schema ${JSON.stringify(schema)} is not an object; accepts any object`,
      ],
    }
  }
  const repairs: string[] = []
  const flattened = flattenRoot(inlineReference(schema, schema, repairs), schema, repairs)
  for (const keyword of ROOT_DROPPED_KEYWORDS) {
    if (flattened[keyword] === undefined) continue
    delete flattened[keyword]
    repairs.push(`dropped root ${keyword}; enforced when the tool runs`)
  }
  const type = flattened.type
  if (type !== 'object') {
    if (!isObjectShaped(flattened)) {
      repairs.push(
        `root type ${JSON.stringify(type)} cannot describe tool arguments; accepts any object`,
      )
      const { description, title, $schema } = flattened
      return {
        schema: {
          type: 'object',
          properties: {},
          ...(description === undefined ? {} : { description }),
          ...(title === undefined ? {} : { title }),
          ...($schema === undefined ? {} : { $schema }),
        },
        repairs: [...new Set(repairs)],
      }
    }
    repairs.push(`set root type ${JSON.stringify(type) ?? 'missing'} to "object"`)
    flattened.type = 'object'
  }
  return { schema: flattened, repairs: [...new Set(repairs)] }
}
