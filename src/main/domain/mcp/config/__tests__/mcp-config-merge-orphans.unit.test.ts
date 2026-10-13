import { describe, expect, it } from 'vitest'
import { type McpConfigLayer, mergeMcpConfigLayers } from '../mcp-config-merge'

/**
 * An orphaned override is one OpenWaggle can offer to remove: only while every file was read and
 * none of them defines the server, even with an error. Removing it otherwise changes what the
 * server does once that file is fixed.
 */

const OW_GLOBAL = '/home/u/.openwaggle/mcp.json'
const PROJECT_MCP_JSON = '/p/.mcp.json'
const PROJECT_OW = '/p/.openwaggle/mcp.json'

function parsed(fileId: McpConfigLayer['fileId'], path: string, value: unknown): McpConfigLayer {
  return { fileId, path, content: { kind: 'parsed', value } }
}

function missing(fileId: McpConfigLayer['fileId'], path: string): McpConfigLayer {
  return { fileId, path, content: { kind: 'missing' } }
}

const PI_GLOBAL_MISSING = missing('pi-global', '/home/u/.pi/agent/mcp.json')
const OVERRIDE = parsed('project-openwaggle', PROJECT_OW, {
  mcpServers: { db: { enabled: false } },
})

function merge(projectMcpJson: McpConfigLayer) {
  return mergeMcpConfigLayers([
    PI_GLOBAL_MISSING,
    missing('openwaggle-global', OW_GLOBAL),
    projectMcpJson,
    missing('project-pi', '/p/.pi/mcp.json'),
    OVERRIDE,
  ])
}

describe('orphaned MCP overrides', () => {
  it('reports an override as orphaned when every file was read and none defines the server', () => {
    const merged = merge(missing('project-mcp-json', PROJECT_MCP_JSON))

    expect(merged.orphanedOverrides).toEqual([
      { name: 'db', fileId: 'project-openwaggle', path: PROJECT_OW },
    ])
  })

  it.each<[string, McpConfigLayer]>([
    [
      'cannot be read',
      {
        fileId: 'project-mcp-json',
        path: PROJECT_MCP_JSON,
        content: { kind: 'unreadable', error: 'Unexpected token' },
      },
    ],
    ['is not an MCP file', parsed('project-mcp-json', PROJECT_MCP_JSON, ['not', 'an', 'object'])],
    [
      'defines the server with an error',
      parsed('project-mcp-json', PROJECT_MCP_JSON, {
        mcpServers: { db: { command: 'db', timeout: -1 } },
      }),
    ],
    [
      'defines the server with project auth',
      parsed('project-mcp-json', PROJECT_MCP_JSON, {
        mcpServers: { db: { url: 'https://db.example/mcp', auth: { provider: 'github' } } },
      }),
    ],
  ])('only warns while another file %s', (_, projectMcpJson) => {
    const merged = merge(projectMcpJson)

    expect(merged.orphanedOverrides ?? []).toEqual([])
    expect(merged.warnings?.join('\n')).toContain(`${PROJECT_OW}: server "db"`)
  })

  it("reports a misspelled full entry in OpenWaggle's file as an error, never as an orphan", () => {
    const merged = mergeMcpConfigLayers([
      PI_GLOBAL_MISSING,
      parsed('openwaggle-global', OW_GLOBAL, {
        mcpServers: {
          db: { comand: 'db-mcp', args: ['--stdio'], env: { TOKEN: { secret: 'DB' } } },
        },
      }),
    ])

    expect(merged.orphanedOverrides ?? []).toEqual([])
    expect(merged.errors.join('\n')).toContain(`${OW_GLOBAL}: server "db" needs "command" or "url"`)
  })
})
