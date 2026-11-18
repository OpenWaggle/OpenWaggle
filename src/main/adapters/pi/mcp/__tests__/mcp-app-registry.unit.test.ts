import { describe, expect, it } from 'vitest'
import { forgetMcpAppTools, mcpAppDescriptor, recordMcpAppTools } from '../mcp-app-registry'

describe('MCP App registry', () => {
  it("remembers which of a Session's tools open an MCP App, per server", () => {
    recordMcpAppTools('s1', 'maps', {
      tools: [
        {
          name: 'show_map',
          title: 'Show map',
          inputSchema: {},
          _meta: { ui: { resourceUri: 'ui://maps/app' } },
        },
        { name: 'legacy', inputSchema: {}, _meta: { 'ui/resourceUri': 'ui://maps/legacy' } },
        { name: 'plain', inputSchema: {} },
        { name: 'web', inputSchema: {}, _meta: { ui: { resourceUri: 'https://not-an-app' } } },
      ],
    })
    const describe = (toolName: string, sessionId = 's1') =>
      mcpAppDescriptor({
        sessionId,
        serverName: 'maps',
        serverIdentity: 'mcp-server:1',
        toolName,
        piToolName: `mcp__maps__${toolName}`,
      })

    expect(describe('show_map')).toEqual({
      serverInstanceId: 'maps',
      serverLabel: 'maps',
      serverConfigHash: 'mcp-server:1',
      toolHandle: 'mcp__maps__show_map',
      toolName: 'show_map',
      toolTitle: 'Show map',
      resourceUri: 'ui://maps/app',
    })
    expect(describe('legacy')?.resourceUri).toBe('ui://maps/legacy')
    expect(describe('plain')).toBeUndefined()
    expect(describe('web')).toBeUndefined()
    expect(describe('show_map', 'other-session')).toBeUndefined()

    forgetMcpAppTools('s1')
    expect(describe('show_map')).toBeUndefined()
  })
})
