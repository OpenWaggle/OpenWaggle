import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { THINKING_LEVELS } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { isAgentDefinitionName } from '../agent-definition-name'

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object.')
  }
  return Object.fromEntries(Object.entries(value))
}

describe('published Agent definition schema', () => {
  it('matches the runtime reasoning levels and portable name policy', async () => {
    const schemaPath = fileURLToPath(
      new URL(
        '../../../../website/public/schemas/agent-definition-v1.schema.json',
        import.meta.url,
      ),
    )
    const schema: unknown = JSON.parse(await readFile(schemaPath, 'utf8'))
    const properties = record(record(schema).properties)
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
})
