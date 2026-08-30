import { describe, expect, it } from 'vitest'
import { validateAgentDefinitionSemantics } from '../agent-definition-semantic-validation'

describe('Agent definition semantic validation', () => {
  it('resolves model, tool, skill, and MCP references against project catalogs', () => {
    expect(
      validateAgentDefinitionSemantics(
        {
          schemaVersion: 1,
          name: 'reviewer',
          description: 'Reviews changes.',
          model: 'openai/gpt-5.6',
          tools: ['read', 'sessions'],
          skills: ['code-review'],
          mcpServers: ['github'],
          instructions: 'Review changes.',
        },
        {
          models: ['openai/gpt-5.6'],
          tools: ['read', 'sessions'],
          skills: ['code-review'],
          mcpServers: ['github', 'mcp:github:1'],
        },
      ),
    ).toEqual({ valid: true, diagnostics: [] })
  })

  it('returns structured, actionable diagnostics for unknown and duplicate references', () => {
    const validation = validateAgentDefinitionSemantics(
      {
        schemaVersion: 1,
        name: 'reviewer',
        description: 'Reviews changes.',
        model: 'openai/missing',
        tools: ['read', 'missing-tool', 'read'],
        skills: ['missing-skill'],
        mcpServers: ['missing-server'],
        instructions: 'Review changes.',
      },
      {
        models: ['openai/gpt-5.6'],
        tools: ['read'],
        skills: ['code-review'],
        mcpServers: ['github'],
      },
    )

    expect(validation.valid).toBe(false)
    expect(validation.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unknown-reference', resource: 'model' }),
        expect.objectContaining({ code: 'unknown-reference', resource: 'tool' }),
        expect.objectContaining({ code: 'duplicate-reference', resource: 'tool', value: 'read' }),
        expect.objectContaining({ code: 'unknown-reference', resource: 'skill' }),
        expect.objectContaining({ code: 'unknown-reference', resource: 'mcp-server' }),
      ]),
    )
    expect(validation.diagnostics.map((diagnostic) => diagnostic.message).join(' ')).toContain(
      'Available values',
    )
  })

  it('blocks referenced fields when their runtime catalog could not be loaded', () => {
    const validation = validateAgentDefinitionSemantics(
      {
        schemaVersion: 1,
        name: 'reviewer',
        description: 'Reviews changes.',
        skills: ['code-review'],
        instructions: 'Review changes.',
      },
      { tools: ['read'], loadDiagnostics: ['Pi resources failed to load.'] },
    )

    expect(validation).toMatchObject({
      valid: false,
      diagnostics: [
        {
          code: 'catalog-unavailable',
          resource: 'skill',
          message: expect.stringContaining('openwaggle agents validate'),
        },
      ],
    })
  })
})
