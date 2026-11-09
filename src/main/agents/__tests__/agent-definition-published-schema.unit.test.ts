import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { SESSION_CAPABILITIES } from '@shared/types/session-capability'
import { THINKING_LEVELS } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { isAgentDefinitionName } from '../agent-definition-name'
import { agentDefinitionFrontmatterSchema, parseAgentDefinition } from '../agent-definition-parser'

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object.')
  }
  return Object.fromEntries(Object.entries(value))
}

async function publishedSchema() {
  const schemaPath = fileURLToPath(
    new URL('../../../../website/public/schemas/agent-definition-v1.schema.json', import.meta.url),
  )
  return record(JSON.parse(await readFile(schemaPath, 'utf8')))
}

function stringPattern(value: unknown) {
  const pattern = record(value).pattern
  if (typeof pattern !== 'string') throw new Error('Expected a string pattern.')
  return new RegExp(pattern, 'u')
}

/**
 * Keywords left out of the comparison. Annotations and references change nothing a document may
 * contain (references are resolved before comparing), and patterns are compared on their own below:
 * the parser enforces names and non-whitespace strings in code, and the tests above check those.
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

function resolveLocalReference(root: Record<string, unknown>, node: Record<string, unknown>) {
  const reference = node.$ref
  if (typeof reference !== 'string') return node
  const name = reference.replace(/^#\/\$defs\//u, '')
  return record(record(root.$defs)[name])
}

function keywordContract(root: Record<string, unknown>, keyword: string, value: unknown): unknown {
  if (keyword === 'properties') {
    return Object.fromEntries(
      Object.entries(record(value))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, property]) => [key, contractOf(root, property)]),
    )
  }
  if (keyword === 'required' && Array.isArray(value)) return [...value].sort()
  if (!SUBSCHEMA_KEYWORDS.has(keyword)) return value
  return Array.isArray(value)
    ? value.map((subschema) => contractOf(root, subschema))
    : contractOf(root, value)
}

/**, so the hand-written published schema and the one
 * Zod generates from the parser compare keyword by keyword, in both directions: a keyword only one
 * of them has fails the comparison. An enum or const already fixes its type, so `type` is dropped
 * there. Zod's implicit `Number.MAX_SAFE_INTEGER` bound on integers is dropped too.
 */
function contractOf(root: Record<string, unknown>, value: unknown): Record<string, unknown> {
  const node = resolveLocalReference(root, record(value))
  const contract: Record<string, unknown> = {}
  for (const [keyword, keywordValue] of Object.entries(node)) {
    if (IGNORED_KEYWORDS.has(keyword)) continue
    contract[keyword] = keywordContract(root, keyword, keywordValue)
  }
  if (contract.enum !== undefined || contract.const !== undefined) delete contract.type
  if (contract.type === 'integer' && contract.maximum === Number.MAX_SAFE_INTEGER) {
    delete contract.maximum
  }
  return contract
}

function patternsOf(value: unknown, path = '#'): Array<[string, unknown]> {
  const node = record(value)
  const own: Array<[string, unknown]> = node.pattern === undefined ? [] : [[path, node.pattern]]
  const items = node.items === undefined ? [] : patternsOf(node.items, `${path}/items`)
  const properties = Object.entries(record(node.properties ?? {})).flatMap(([key, property]) =>
    patternsOf(property, `${path}/properties/${key}`),
  )
  return [...own, ...items, ...properties]
}

function patternAt(root: Record<string, unknown>, path: string) {
  let node = root
  for (const segment of path.split('/').slice(1)) {
    node = resolveLocalReference(root, record(node[segment]))
  }
  return node.pattern
}

describe('published Agent definition schema', () => {
  it('matches the runtime reasoning levels and portable name policy', async () => {
    const properties = record((await publishedSchema()).properties)
    const reasoning = record(properties.reasoning)
    const name = record(properties.name)
    if (!Array.isArray(reasoning.enum) || typeof name.pattern !== 'string') {
      throw new Error('The published Agent definition schema is incomplete.')
    }

    expect(reasoning.enum).toEqual([...THINKING_LEVELS])
    const publishedNamePattern = new RegExp(name.pattern)
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
      'a'.repeat(80),
      'a'.repeat(81),
      `r${'-'.repeat(78)}r`,
    ]) {
      expect(publishedNamePattern.test(candidate), candidate).toBe(isAgentDefinitionName(candidate))
    }
    expect(isAgentDefinitionName('a'.repeat(80))).toBe(true)
    expect(isAgentDefinitionName('a'.repeat(81))).toBe(false)
  })

  it('matches runtime non-whitespace requirements for user-authored strings', async () => {
    const schema = await publishedSchema()
    const properties = record(schema.properties)
    const nameList = record(record(schema.$defs).nameList)
    const nameListPattern = stringPattern(record(nameList.items))
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
    const properties = record((await publishedSchema()).properties)
    const capabilities = record(properties.sessionCapabilities)

    expect(record(capabilities.items).enum).toEqual([...SESSION_CAPABILITIES])
    expect(capabilities.maxItems).toBe(SESSION_CAPABILITIES.length)
  })

  it('matches the parser field by field: names, required fields, types, enums and limits', async () => {
    const published = await publishedSchema()
    const generated = record(z.toJSONSchema(agentDefinitionFrontmatterSchema))

    expect(contractOf(published, published)).toEqual(contractOf(generated, generated))
    for (const [path, pattern] of patternsOf(generated)) {
      expect(patternAt(published, path), path).toBe(pattern)
    }
  })
})
