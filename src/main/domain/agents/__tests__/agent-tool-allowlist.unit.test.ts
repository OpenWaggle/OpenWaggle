import { describe, expect, it } from 'vitest'
import { agentToolAllowlist, isAgentMcpToolReference } from '../agent-tool-allowlist'

describe('Agent-definition tool allowlists', () => {
  it('allows exactly the listed tools when no MCP tool is named', () => {
    const allows = agentToolAllowlist({ tools: ['read', 'bash'] })

    expect(['read', 'bash', 'write', 'codemode', 'mcp__docs__search'].filter(allows)).toEqual([
      'read',
      'bash',
    ])
  })

  it('allows MCP tools by Pi name or pattern, and the tools that reach them', () => {
    const allows = agentToolAllowlist({ tools: ['read', 'mcp__docs__*', 'mcp__github__get_issue'] })

    expect(
      [
        'mcp__docs__search',
        'mcp__github__get_issue',
        'mcp__github__delete_repo',
        'codemode',
        'tool_search',
        'read_mcp_resource',
        'bash',
      ].filter(allows),
    ).toEqual([
      'mcp__docs__search',
      'mcp__github__get_issue',
      'codemode',
      'tool_search',
      'read_mcp_resource',
    ])
  })

  it("reads a legacy mcp or mcp_run entry as every MCP tool of the definition's servers", () => {
    const narrowed = agentToolAllowlist({ tools: ['mcp_run'], mcpServers: ['dev-radius'] })
    const all = agentToolAllowlist({ tools: ['mcp'] })

    expect(narrowed('mcp__dev_radius__lookup')).toBe(true)
    expect(narrowed('mcp__github__get_issue')).toBe(false)
    expect(narrowed('codemode')).toBe(true)
    expect(all('mcp__github__get_issue')).toBe(true)
    expect(all('bash')).toBe(false)
  })

  it('recognises MCP tool references', () => {
    expect(
      ['mcp', 'mcp_run', 'mcp__docs__*', 'mcp__docs__search', 'read', 'mcp__'].map(
        isAgentMcpToolReference,
      ),
    ).toEqual([true, true, true, true, false, false])
  })
})
