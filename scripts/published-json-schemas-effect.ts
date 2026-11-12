/**
 * Turns a runtime Effect Schema into the JSON Schema published under `website/public/schemas/`.
 *
 * Effect's generator writes its own `title` and `description` for built-in refinements, such as
 * `maxLength(120)`. They describe the check, not the field, so they are removed and the field
 * descriptions come from a curated overlay keyed by JSON Pointer. Every overlay pointer must
 * exist in the generated schema: a renamed or removed runtime field fails generation instead of
 * leaving a stale description behind.
 */
import { JSONSchema, type Schema } from 'effect'

export type JsonSchemaNode = Readonly<Record<string, unknown>>

/** Keywords to merge into the node at each JSON Pointer of the generated schema. */
export type JsonSchemaOverlay = Readonly<Record<string, JsonSchemaNode>>

const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema'
const PUBLISHED_SCHEMA_ORIGIN = 'https://openwaggle.ai/schemas/'

function isNode(value: unknown): value is JsonSchemaNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const GENERATED_ANNOTATIONS = new Set(['title', 'description', '$schema'])
/** Keywords whose value maps names to schemas, so its own keys are names, not keywords. */
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs'])

function cleanSchemaMap(value: unknown): unknown {
  if (!isNode(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([name, entry]) => [name, withoutGeneratedAnnotations(entry)]),
  )
}

/**
 * Removes Effect's refinement titles and descriptions, its internal `$id` markers such as
 * `/schemas/unknown`, and empty `required` lists, none of which mean anything to an editor.
 */
function withoutGeneratedAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutGeneratedAnnotations)
  if (!isNode(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entry]) => {
        if (GENERATED_ANNOTATIONS.has(key)) return false
        if (key === '$id' && typeof entry === 'string' && entry.startsWith('/schemas/')) {
          return false
        }
        return !(key === 'required' && Array.isArray(entry) && entry.length === 0)
      })
      .map(([key, entry]) => [
        key,
        SCHEMA_MAPS.has(key) ? cleanSchemaMap(entry) : withoutGeneratedAnnotations(entry),
      ]),
  )
}

function pointerSegments(pointer: string) {
  if (pointer === '') return []
  if (!pointer.startsWith('/')) throw new Error(`JSON Pointer must start with "/": ${pointer}`)
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function mergeAt(
  node: unknown,
  segments: readonly string[],
  patch: JsonSchemaNode,
  pointer: string,
): unknown {
  const missing = () => new Error(`No schema object at ${pointer}.`)
  const [head, ...rest] = segments
  if (head === undefined) {
    if (!isNode(node)) throw missing()
    return { ...node, ...patch }
  }
  if (Array.isArray(node)) {
    const list: readonly unknown[] = node
    const index = Number(head)
    if (!Number.isInteger(index) || index < 0 || index >= list.length) throw missing()
    return list.map((entry, position) =>
      position === index ? mergeAt(entry, rest, patch, pointer) : entry,
    )
  }
  if (!isNode(node) || !(head in node)) throw missing()
  return { ...node, [head]: mergeAt(node[head], rest, patch, pointer) }
}

/** Merge each overlay entry into the node its pointer names; a missing node is an error. */
function applyJsonSchemaOverlay(schema: JsonSchemaNode, overlay: JsonSchemaOverlay) {
  let next: unknown = schema
  for (const [pointer, patch] of Object.entries(overlay)) {
    next = mergeAt(next, pointerSegments(pointer), patch, pointer)
  }
  if (!isNode(next)) throw new Error('A JSON Schema must be an object.')
  return next
}

interface PublishedSchemaHeader {
  /** File name under `website/public/schemas/`. */
  readonly fileName: string
  readonly title: string
  readonly description: string
}

/** The schema header every published file starts with, in a stable key order. */
export function publishedSchemaRoot(header: PublishedSchemaHeader, body: JsonSchemaNode) {
  return {
    $schema: JSON_SCHEMA_DIALECT,
    $id: `${PUBLISHED_SCHEMA_ORIGIN}${header.fileName}`,
    title: header.title,
    description: header.description,
    ...body,
  }
}

/** JSON Schema 2020-12 for a runtime schema, with curated descriptions instead of Effect's. */
export function jsonSchemaFromEffect<A, I>(
  schema: Schema.Schema<A, I>,
  overlay: JsonSchemaOverlay,
): JsonSchemaNode {
  const generated = withoutGeneratedAnnotations(
    JSONSchema.make(schema, { target: 'jsonSchema2020-12' }),
  )
  if (!isNode(generated)) throw new Error('Effect generated a JSON Schema that is not an object.')
  return applyJsonSchemaOverlay(generated, overlay)
}
