import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { THINKING_LEVELS } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { isAgentDefinitionName } from '../agent-definition-name'
import { parseAgentDefinition } from '../agent-definition-parser'

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
})
