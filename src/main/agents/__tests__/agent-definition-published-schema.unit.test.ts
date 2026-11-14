import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { SESSION_CAPABILITIES } from '@shared/types/session-capability'
import { THINKING_LEVELS } from '@shared/types/settings'
import { JSONSchema } from 'effect'
import { describe, expect, it } from 'vitest'
import { AGENT_DEFINITION_NAME_PATTERN, isAgentDefinitionName } from '../agent-definition-name'
import { agentDefinitionFrontmatterSchema, parseAgentDefinition } from '../agent-definition-parser'

function record(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object.')
  }
  const result: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  return result
}

/** The JSON Schema keywords these tests read by name; a node keeps every other keyword too. */
interface JsonSchemaKeywords {
  readonly $ref?: unknown
  readonly $defs?: unknown
  readonly properties?: unknown
  readonly pattern?: unknown
  readonly items?: unknown
  readonly enum?: unknown
  readonly const?: unknown
  readonly type?: unknown
  readonly maxItems?: unknown
}

/** A JSON object read through the keywords it may declare. */
function keywords(value: unknown) {
  const result: JsonSchemaKeywords = record(value)
  return result
}

async function publishedSchema() {
  const schemaPath = fileURLToPath(
    new URL('../../../../website/public/schemas/agent-definition-v1.schema.json', import.meta.url),
  )
  return record(JSON.parse(await readFile(schemaPath, 'utf8')))
}

/** The published top-level properties these tests check. */
const publishedPropertiesSchema = Schema.Struct({
  name: Schema.Unknown,
  description: Schema.Unknown,
  model: Schema.Unknown,
  reasoning: Schema.Unknown,
  sessionCapabilities: Schema.Unknown,
})
const publishedDefinitionsSchema = Schema.Struct({ nameList: Schema.Unknown })

function publishedProperties(schema: unknown) {
  return decodeUnknownOrThrow(publishedPropertiesSchema, keywords(schema).properties)
}

function stringPattern(value: unknown) {
  const { pattern } = keywords(value)
  if (typeof pattern !== 'string') throw new Error('Expected a string pattern.')
  return new RegExp(pattern, 'u')
}

/**
 * Keywords left out of the comparison. Annotations and references change nothing a document may
 * contain (references are resolved before comparing), and patterns are compared on their own below.
 */
const IGNORED_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$defs',
  '$ref',
  'title',
  'description',
  'pattern',
])
/** Keywords whose value is a schema, or a list of schemas, to compare the same way. */
const SUBSCHEMA_KEYWORDS = new Set(['items', 'not', 'anyOf', 'oneOf', 'allOf'])
/**
 * Published patterns the parser enforces in code rather than with a schema pattern, and the exact pattern
 * each must be: the portable name, which `isAgentDefinitionName` tests with exactly this regex, and
 * the non-whitespace strings. The behavioral tests below also sample each of them.
 */
const NON_WHITESPACE_PATTERN = '\\S'
const CODE_ENFORCED_PATTERNS = new Map([
  ['#/properties/name', AGENT_DEFINITION_NAME_PATTERN.source],
  ['#/properties/description', NON_WHITESPACE_PATTERN],
  ['#/properties/model', NON_WHITESPACE_PATTERN],
  ['#/properties/tools/items', NON_WHITESPACE_PATTERN],
  ['#/properties/skills/items', NON_WHITESPACE_PATTERN],
  ['#/properties/mcpServers/items', NON_WHITESPACE_PATTERN],
])

/**
 * Replaces a local `$ref` with its definition, following a definition that is itself a `$ref`.
 * Sibling keywords still apply in draft 2020-12, and both apply when the definition has the same
 * keyword, so a sibling that differs from it is refused here.
 */
function resolveLocalReference(
  root: Record<string, unknown>,
  node: Record<string, unknown>,
  visited: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  const reference = keywords(node).$ref
  if (typeof reference !== 'string') return node
  if (visited.has(reference)) throw new Error(`${reference} refers to itself.`)
  const name = reference.replace(/^#\/\$defs\//u, '')
  const definition = record(record(keywords(root).$defs)[name])
  const siblings = Object.entries(node).filter(([keyword]) => keyword !== '$ref')
  for (const [keyword, value] of siblings) {
    if (keyword in definition && JSON.stringify(definition[keyword]) !== JSON.stringify(value)) {
      throw new Error(`${reference} and the keyword "${keyword}" beside it disagree.`)
    }
  }
  return resolveLocalReference(
    root,
    { ...definition, ...Object.fromEntries(siblings) },
    new Set([...visited, reference]),
  )
}

function jsonTypeOf(value: unknown) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

/** Whether `type` allows every enum or const value, so the values alone already fix it. */
function typeAgreesWithValues(type: unknown, values: unknown[]) {
  return values.every((value) => {
    const valueType = jsonTypeOf(value)
    return type === valueType || (type === 'number' && valueType === 'integer')
  })
}

function keywordContract(root: Record<string, unknown>, keyword: string, value: unknown): unknown {
  if (keyword === 'properties') {
    return Object.fromEntries(
      Object.entries(record(value))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, property]) => [key, contractOf(root, property)]),
    )
  }
  if (keyword === 'required' && Array.isArray(value)) return value.map(String).toSorted()
  if (!SUBSCHEMA_KEYWORDS.has(keyword)) return value
  return Array.isArray(value)
    ? value.map((subschema) => contractOf(root, subschema))
    : contractOf(root, value)
}

/**
 * Reduces a schema to the keywords that constrain a document, so the hand-written published schema
 * and the one Effect Schema generates from the parser compare keyword by keyword, in both directions: a
 * keyword only one of them has fails the comparison. An enum or const already fixes its type, so
 * `type` is dropped there when it allows every value; a `type` that contradicts them stays and fails.
 */
function contractOf(root: Record<string, unknown>, value: unknown): Record<string, unknown> {
  const node = resolveLocalReference(root, record(value))
  const contract: Record<string, unknown> = {}
  for (const [keyword, keywordValue] of Object.entries(node)) {
    if (IGNORED_KEYWORDS.has(keyword)) continue
    contract[keyword] = keywordContract(root, keyword, keywordValue)
  }
  const constraint = keywords(contract)
  const values = Array.isArray(constraint.enum)
    ? constraint.enum
    : 'const' in constraint
      ? [constraint.const]
      : undefined
  if (values && (constraint.type === undefined || typeAgreesWithValues(constraint.type, values))) {
    return Object.fromEntries(Object.entries(contract).filter(([keyword]) => keyword !== 'type'))
  }
  return contract
}

function patternsOf(
  root: Record<string, unknown>,
  value: unknown,
  path = '#',
): [string, unknown][] {
  const node = resolveLocalReference(root, record(value))
  const { pattern, properties } = keywords(node)
  const own: [string, unknown][] = pattern === undefined ? [] : [[path, pattern]]
  const subschemas = [...SUBSCHEMA_KEYWORDS].flatMap((keyword) => {
    const subschema = node[keyword]
    if (subschema === undefined) return []
    if (!Array.isArray(subschema)) return patternsOf(root, subschema, `${path}/${keyword}`)
    return subschema.flatMap((entry, index) =>
      patternsOf(root, entry, `${path}/${keyword}/${index}`),
    )
  })
  const propertyPatterns = Object.entries(record(properties ?? {})).flatMap(([key, property]) =>
    patternsOf(root, property, `${path}/properties/${key}`),
  )
  return [...own, ...subschemas, ...propertyPatterns]
}

describe('published Agent definition schema', () => {
  it('matches the runtime reasoning levels and portable name policy', async () => {
    const properties = publishedProperties(await publishedSchema())
    const reasoning = keywords(properties.reasoning)
    const name = keywords(properties.name)
    if (!Array.isArray(reasoning.enum) || typeof name.pattern !== 'string') {
      throw new Error('The published Agent definition schema is incomplete.')
    }

    expect(reasoning.enum).toEqual([...THINKING_LEVELS])
    const publishedNamePattern = new RegExp(name.pattern, 'u')
    for (const candidate of [
      'reviewer',
      'release.review',
      'con',
      'con.logs',
      'aux',
      'com1',
      'lpt9.output',
      'COM1',
      '-invalid',
      'a',
      '_a',
      'reView',
      'reviewer.',
      'reviewer-',
      'prn',
      'nul.x',
      'lpt0',
      'com0.notes',
      'Reviewer',
      'revieweR',
      'a~b',
      'a..b',
      'a.-_b',
      'a__b',
      '0.1.2',
      'a\n-',
      'a'.repeat(80),
      'a'.repeat(81),
      `r${'-'.repeat(78)}r`,
    ]) {
      expect(publishedNamePattern.test(candidate), candidate).toBe(isAgentDefinitionName(candidate))
    }
    expect(isAgentDefinitionName('a'.repeat(80))).toBe(true)
    expect(isAgentDefinitionName('a'.repeat(81))).toBe(false)
    // The pattern is published without flags, so the runtime regex must not have any either.
    expect(AGENT_DEFINITION_NAME_PATTERN.flags).toBe('')
    expect(isAgentDefinitionName('a\n-')).toBe(false)
  })

  it('matches runtime non-whitespace requirements for user-authored strings', async () => {
    const schema = await publishedSchema()
    const properties = publishedProperties(schema)
    const nameList = keywords(
      decodeUnknownOrThrow(publishedDefinitionsSchema, keywords(schema).$defs).nameList,
    )
    const nameListPattern = stringPattern(nameList.items)
    const whitespace = ' \t '

    expect(stringPattern(properties.description).test(whitespace)).toBe(false)
    expect(stringPattern(properties.model).test(whitespace)).toBe(false)
    expect(nameListPattern.test(whitespace)).toBe(false)
    expect(stringPattern(properties.description).test(' Reviews changes. ')).toBe(true)
    expect(stringPattern(properties.model).test(' openai/gpt-5.6 ')).toBe(true)
    expect(nameListPattern.test(' read ')).toBe(true)

    const invalidDocuments = [
      `---\nschemaVersion: 1\nname: reviewer\ndescription: "${whitespace}"\n---\nReview.\n`,
      `---\nschemaVersion: 1\nname: reviewer\ndescription: Reviews\nmodel: "${whitespace}"\n---\nReview.\n`,
      ...['tools', 'skills', 'mcpServers'].map(
        (field) =>
          `---\nschemaVersion: 1\nname: reviewer\ndescription: Reviews\n${field}: ["${whitespace}"]\n---\nReview.\n`,
      ),
    ]
    for (const markdown of invalidDocuments) {
      expect(() => parseAgentDefinition(markdown)).toThrow()
    }
  })

  it('lists every Session capability the parser accepts, and no more', async () => {
    const capabilities = keywords(publishedProperties(await publishedSchema()).sessionCapabilities)

    expect(keywords(capabilities.items).enum).toEqual([...SESSION_CAPABILITIES])
    expect(capabilities.maxItems).toBe(SESSION_CAPABILITIES.length)
  })

  it('matches the parser keyword by keyword: names, required fields, types, enums and limits', async () => {
    const published = await publishedSchema()
    // The published schema describes the documents people write, so compare the parser's input
    // side, which `JSONSchema.make` describes.
    const generated = record(
      JSONSchema.make(agentDefinitionFrontmatterSchema, { target: 'jsonSchema2020-12' }),
    )

    expect(contractOf(published, published)).toEqual(contractOf(generated, generated))

    const publishedPatterns = new Map(patternsOf(published, published))
    const generatedPatterns = new Map(patternsOf(generated, generated))
    for (const [path, pattern] of CODE_ENFORCED_PATTERNS) {
      expect(generatedPatterns.has(path), path).toBe(false)
      expect(publishedPatterns.get(path), path).toBe(pattern)
    }
    for (const path of new Set([...publishedPatterns.keys(), ...generatedPatterns.keys()])) {
      if (CODE_ENFORCED_PATTERNS.has(path)) continue
      expect(publishedPatterns.get(path), path).toBe(generatedPatterns.get(path))
    }
  })
})
