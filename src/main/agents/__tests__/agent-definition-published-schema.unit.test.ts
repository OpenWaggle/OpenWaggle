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

/** Keywords whose values the runtime parser decides; both schemas must agree on each of them. */
const CONTRACT_KEYWORDS = [
  'type',
  'const',
  'enum',
  'format',
  'minLength',
  'maxLength',
  'minimum',
  'maxItems',
  'additionalProperties',
] as const

function resolveLocalReference(root: Record<string, unknown>, node: Record<string, unknown>) {
  const reference = node.$ref
  if (typeof reference !== 'string') return node
  const name = reference.replace(/^#\/\$defs\//u, '')
  return record(record(root.$defs)[name])
}

/**
 * Reduces a JSON Schema node to the parts the runtime parser decides, so the hand-written published
 * schema and the one Zod generates from the parser compare field by field. Patterns are left out:
 * the parser enforces names and non-whitespace strings in code, and the tests above check those.
 * An enum or const already fixes its type, so `type` is dropped there; Zod's implicit
 * `Number.MAX_SAFE_INTEGER` bound on integers is dropped too.
 */
function contractOf(root: Record<string, unknown>, value: unknown): Record<string, unknown> {
  const node = resolveLocalReference(root, record(value))
  const contract: Record<string, unknown> = {}
  for (const keyword of CONTRACT_KEYWORDS) {
    if (node[keyword] !== undefined) contract[keyword] = node[keyword]
  }
  if (contract.enum !== undefined || contract.const !== undefined) delete contract.type
  if (contract.type === 'integer' && node.maximum === Number.MAX_SAFE_INTEGER) {
    delete contract.maximum
  }
  if (Array.isArray(node.required)) contract.required = [...node.required].sort()
  if (node.items !== undefined) contract.items = contractOf(root, node.items)
  if (node.properties !== undefined) {
    contract.properties = Object.fromEntries(
      Object.entries(record(node.properties))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, property]) => [key, contractOf(root, property)]),
    )
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
    ]) {
      expect(publishedNamePattern.test(candidate), candidate).toBe(isAgentDefinitionName(candidate))
    }
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
