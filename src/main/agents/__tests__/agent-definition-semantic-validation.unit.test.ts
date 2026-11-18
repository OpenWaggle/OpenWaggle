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
          tools: ['read', 'hive'],
          skills: ['code-review'],
          mcpServers: ['github'],
          instructions: 'Review changes.',
        },
        {
          models: ['openai/gpt-5.6'],
          tools: ['read', 'hive'],
          skills: ['code-review'],
          mcpServers: ['github', 'mcp:github:1'],
        },
      ),
    ).toEqual({ valid: true, diagnostics: [] })
  })

  it('accepts MCP tools by Pi name or pattern for configured servers, and legacy mcp entries', () => {
    const definition = (tools: readonly string[]) => ({
      schemaVersion: 1 as const,
      name: 'reviewer',
      description: 'Reviews changes.',
      tools,
      instructions: 'Review changes.',
    })
    const catalog = { tools: ['read'], mcpServers: ['dev-radius', 'github'] }

    expect(
      validateAgentDefinitionSemantics(
        definition(['read', 'mcp__dev_radius__*', 'mcp__github__get_issue', 'codemode']),
        catalog,
      ),
    ).toEqual({ valid: true, diagnostics: [] })
    expect(validateAgentDefinitionSemantics(definition(['mcp', 'mcp_run']), catalog).valid).toBe(
      true,
    )
    expect(
      validateAgentDefinitionSemantics(definition(['mcp__unknown__*']), catalog).diagnostics,
    ).toMatchObject([{ code: 'unknown-reference', resource: 'tool', value: 'mcp__unknown__*' }])
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

  it('reports the MCP configuration error, not unknown tools, when MCP servers did not load', () => {
    const mcpError = 'mcp.json: Unexpected token } in JSON at position 42'
    const validation = validateAgentDefinitionSemantics(
      {
        schemaVersion: 1,
        name: 'reviewer',
        description: 'Reviews changes.',
        tools: ['read', 'mcp__github__search_issues'],
        instructions: 'Review changes.',
      },
      { tools: ['read'], loadDiagnostics: [mcpError] },
    )

    expect(validation.diagnostics).toEqual([
      {
        code: 'catalog-unavailable',
        resource: 'mcp-server',
        message: expect.stringContaining(mcpError),
      },
    ])
  })
})
