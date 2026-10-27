import { describe, expect, it } from 'vitest'
import { memoryMcpToolCatalogStore } from '../../../mcp/pool/mcp-connection-catalog'
import { mcpToolCatalogKeyOf, withCachedMcpDescriptions } from '../mcp-tool-catalogs'

const datadog = { name: 'datadog', config: { command: 'datadog_mcp_cli' }, source: 'mcp.json' }
const config = { transports: new Map([['datadog', 'stdio' as const]]) }

describe('MCP tool catalogs at Run start (C9)', () => {
  it('describes a server by its cached instructions, so <mcp_servers> never changes', () => {
    const store = memoryMcpToolCatalogStore()
    const key = mcpToolCatalogKeyOf({ entry: datadog, config, projectPath: null })
    store.write(key, {
      initialize: { instructions: 'Query Datadog logs and metrics.\nMore detail.' },
      toolsPages: {},
      savedAt: Date.now(),
    })
    const described = { name: 'docs', config: { command: 'docs', description: 'Mine' }, source: 'x' }

    const loaded = withCachedMcpDescriptions(
      { servers: [datadog, described], errors: [] },
      (entry) => mcpToolCatalogKeyOf({ entry, config, projectPath: null }),
      store,
    )

    expect(loaded.servers.map((entry) => entry.config.description)).toEqual([
      'Query Datadog logs and metrics.',
      'Mine',
    ])
    expect(loaded.errors).toEqual([])
  })

  it('keys a catalog by server and project, not by the worktree a Run uses', () => {
    const key = (projectPath: string | null, command = 'datadog_mcp_cli') =>
      mcpToolCatalogKeyOf({
        entry: { ...datadog, config: { command } },
        config,
        projectPath,
      })
    expect(key('/repo')).toBe(key('/repo'))
    expect(key('/repo')).not.toBe(key('/other'))
    expect(key('/repo')).not.toBe(key('/repo', 'other_cli'))
  })
})
