import { describe, expect, it } from 'vitest'
import { type McpConfigLayer, mergeMcpConfigLayers } from '../mcp-config-merge'

const PI_GLOBAL = '/home/u/.pi/agent/mcp.json'
const OW_GLOBAL = '/home/u/.openwaggle/mcp.json'
const PROJECT_MCP_JSON = '/p/.mcp.json'
const PROJECT_PI = '/p/.pi/mcp.json'
const PROJECT_OW = '/p/.openwaggle/mcp.json'

function layer(fileId: McpConfigLayer['fileId'], path: string, value: unknown): McpConfigLayer {
  return { fileId, path, content: { kind: 'parsed', value } }
}

function fileSet(input: {
  readonly piGlobal?: unknown
  readonly openwaggleGlobal?: unknown
  readonly projectMcpJson?: unknown
  readonly projectPi?: unknown
  readonly projectOpenwaggle?: unknown
}): McpConfigLayer[] {
  const missing = { kind: 'missing' } as const
  return [
    input.piGlobal === undefined
      ? { fileId: 'pi-global', path: PI_GLOBAL, content: missing }
      : layer('pi-global', PI_GLOBAL, input.piGlobal),
    input.openwaggleGlobal === undefined
      ? { fileId: 'openwaggle-global', path: OW_GLOBAL, content: missing }
      : layer('openwaggle-global', OW_GLOBAL, input.openwaggleGlobal),
    input.projectMcpJson === undefined
      ? { fileId: 'project-mcp-json', path: PROJECT_MCP_JSON, content: missing }
      : layer('project-mcp-json', PROJECT_MCP_JSON, input.projectMcpJson),
    input.projectPi === undefined
      ? { fileId: 'project-pi', path: PROJECT_PI, content: missing }
      : layer('project-pi', PROJECT_PI, input.projectPi),
    input.projectOpenwaggle === undefined
      ? { fileId: 'project-openwaggle', path: PROJECT_OW, content: missing }
      : layer('project-openwaggle', PROJECT_OW, input.projectOpenwaggle),
  ]
}

describe('MCP configuration file merge', () => {
  it('reads a Pi global server with its defining file and scope', () => {
    const merged = mergeMcpConfigLayers(
      fileSet({ piGlobal: { mcpServers: { docs: { url: 'https://example.com/mcp' } } } }),
    )

    expect(merged.errors).toEqual([])
    expect(merged.servers).toEqual([
      {
        name: 'docs',
        config: { url: 'https://example.com/mcp' },
        transport: 'http',
        source: { fileId: 'pi-global', path: PI_GLOBAL },
        scope: 'global',
      },
    ])
  })

  it('lets a project file replace a global server of the same name', () => {
    const merged = mergeMcpConfigLayers(
      fileSet({
        piGlobal: { mcpServers: { docs: { url: 'https://global.example/mcp' } } },
        projectPi: { mcpServers: { docs: { command: 'docs-mcp', args: ['--local'] } } },
      }),
    )

    expect(merged.servers).toEqual([
      {
        name: 'docs',
        config: { command: 'docs-mcp', args: ['--local'] },
        transport: 'stdio',
        source: { fileId: 'project-pi', path: PROJECT_PI },
        scope: 'project',
      },
    ])
  })

  it('lets a later file beat an earlier one in the same scope', () => {
    const merged = mergeMcpConfigLayers(
      fileSet({
        piGlobal: { mcpServers: { docs: { url: 'https://pi.example/mcp' } } },
        openwaggleGlobal: { mcpServers: { docs: { url: 'https://openwaggle.example/mcp' } } },
        projectMcpJson: { mcpServers: { tools: { command: 'a' } } },
        projectOpenwaggle: { mcpServers: { tools: { command: 'b' } } },
      }),
    )

    expect(merged.servers.map((server) => [server.name, server.source.fileId])).toEqual([
      ['docs', 'openwaggle-global'],
      ['tools', 'project-openwaggle'],
    ])
    expect(merged.servers[0]?.config).toEqual({ url: 'https://openwaggle.example/mcp' })
  })

  it('applies an override-only entry to enabled and exposure and keeps the rest', () => {
    const merged = mergeMcpConfigLayers(
      fileSet({
        piGlobal: {
          mcpServers: {
            figma: { command: 'npx', args: ['figma-mcp'], env: { TOKEN: 'plain-token' } },
          },
        },
        openwaggleGlobal: { mcpServers: { figma: { exposure: 'direct' } } },
        projectOpenwaggle: { mcpServers: { figma: { enabled: false } } },
      }),
    )

    expect(merged.errors).toEqual([])
    expect(merged.servers).toEqual([
      {
        name: 'figma',
        config: {
          command: 'npx',
          args: ['figma-mcp'],
          env: { TOKEN: 'plain-token' },
          exposure: 'direct',
          enabled: false,
        },
        transport: 'stdio',
        source: { fileId: 'pi-global', path: PI_GLOBAL },
        scope: 'global',
        override: { fileId: 'project-openwaggle', path: PROJECT_OW },
      },
    ])
  })

  it('drops an earlier override when a later file defines the server again', () => {
    const merged = mergeMcpConfigLayers(
      fileSet({
        piGlobal: { mcpServers: { docs: { url: 'https://a.example/mcp' } } },
        openwaggleGlobal: { mcpServers: { docs: { enabled: false } } },
        projectMcpJson: { mcpServers: { docs: { url: 'https://b.example/mcp' } } },
      }),
    )

    expect(merged.servers).toEqual([
      {
        name: 'docs',
        config: { url: 'https://b.example/mcp' },
        transport: 'http',
        source: { fileId: 'project-mcp-json', path: PROJECT_MCP_JSON },
        scope: 'project',
      },
    ])
  })

  it('reports an override with nothing to override or with other keys', () => {
    const merged = mergeMcpConfigLayers(
      fileSet({
        piGlobal: { mcpServers: { docs: { url: 'https://a.example/mcp' } } },
        projectPi: {
          mcpServers: { ghost: { enabled: false }, docs: { enabled: false, timeout: 5 } },
        },
      }),
    )

    expect(merged.errors).toEqual([
      `${PROJECT_PI}: server "ghost" needs "command" or "url", or a server in an earlier file to override`,
      `${PROJECT_PI}: server "docs": an override can only set enabled, exposure, toolExposure`,
    ])
    expect(merged.servers.map((server) => server.override)).toEqual([undefined])
  })

  it('treats an entry without command or url in the first file as invalid, like Pi', () => {
    const merged = mergeMcpConfigLayers(
      fileSet({ piGlobal: { mcpServers: { docs: { enabled: false } } } }),
    )

    expect(merged.servers).toEqual([])
    expect(merged.errors).toEqual([
      `${PI_GLOBAL}: server "docs" needs either "command" (stdio) or "url" (streamable HTTP)`,
    ])
  })

  it('skips invalid entries and unreadable files without dropping other servers', () => {
    const merged = mergeMcpConfigLayers([
      {
        fileId: 'pi-global',
        path: PI_GLOBAL,
        content: { kind: 'unreadable', error: 'Unexpected token' },
      },
      layer('openwaggle-global', OW_GLOBAL, {
        mcpServers: { 'bad name': { command: 'x' }, ok: { command: 'ok' }, worse: { command: 1 } },
      }),
      layer('project-mcp-json', PROJECT_MCP_JSON, []),
    ])

    expect(merged.servers.map((server) => server.name)).toEqual(['ok'])
    expect(merged.errors).toEqual([
      `${PI_GLOBAL}: Unexpected token`,
      `${OW_GLOBAL}: invalid server name "bad name" (use letters, digits, "_" and "-")`,
      `${OW_GLOBAL}: server "worse" needs either "command" (stdio) or "url" (streamable HTTP)`,
      `${PROJECT_MCP_JSON}: expected an object with an "mcpServers" object`,
    ])
  })

  it('rejects a second server whose name differs only in - and _', () => {
    const merged = mergeMcpConfigLayers(
      fileSet({
        piGlobal: { mcpServers: { 'dev-radius': { command: 'a' } } },
        projectPi: { mcpServers: { dev_radius: { command: 'b' } } },
      }),
    )

    expect(merged.servers.map((server) => server.name)).toEqual(['dev-radius'])
    expect(merged.errors).toEqual([
      `${PROJECT_PI}: server "dev_radius" conflicts with "dev-radius"`,
    ])
  })

  it('allows vault secret references only in OpenWaggle files', () => {
    const merged = mergeMcpConfigLayers(
      fileSet({
        openwaggleGlobal: {
          mcpServers: {
            a: { url: 'https://a.example', headers: { Authorization: { secret: 'a-token' } } },
          },
        },
        projectMcpJson: {
          mcpServers: { b: { command: 'b', env: { TOKEN: { secret: 'b-token' } } } },
        },
      }),
    )

    expect(merged.servers.map((server) => server.config)).toEqual([
      { url: 'https://a.example', headers: { Authorization: { secret: 'a-token' } } },
    ])
    expect(merged.errors).toEqual([
      `${PROJECT_MCP_JSON}: server "b": env "TOKEN" uses a vault secret reference, which only OpenWaggle's files (~/.openwaggle/mcp.json and .openwaggle/mcp.json) may hold`,
    ])
  })

  it('keeps provider auth out of project files', () => {
    const merged = mergeMcpConfigLayers(
      fileSet({
        openwaggleGlobal: {
          mcpServers: { a: { url: 'https://a.example', auth: { provider: 'github' } } },
        },
        projectOpenwaggle: {
          mcpServers: { b: { url: 'https://b.example', auth: { provider: 'github' } } },
        },
      }),
    )

    expect(merged.servers.map((server) => server.name)).toEqual(['a'])
    expect(merged.errors).toEqual([
      `${PROJECT_OW}: server "b": auth is only allowed in a global mcp.json`,
    ])
  })

  it('carries legacy SSE and WebSocket transports beside a Pi-shaped config', () => {
    const merged = mergeMcpConfigLayers(
      fileSet({
        projectMcpJson: {
          mcpServers: {
            legacy: { type: 'sse', url: 'https://legacy.example/sse' },
            socket: { url: 'wss://socket.example/mcp' },
          },
        },
        projectOpenwaggle: { mcpServers: { legacy: { exposure: 'deferred' } } },
      }),
    )

    expect(merged.errors).toEqual([])
    expect(merged.servers.map((server) => [server.name, server.transport, server.config])).toEqual([
      ['legacy', 'sse', { url: 'https://legacy.example/sse', exposure: 'deferred' }],
      ['socket', 'websocket', { url: 'wss://socket.example/mcp' }],
    ])
  })

  it('takes autoEnableCodemode from the last file that sets it', () => {
    const merged = mergeMcpConfigLayers(
      fileSet({
        piGlobal: { autoEnableCodemode: false },
        projectPi: { autoEnableCodemode: true },
      }),
    )

    expect(merged.autoEnableCodemode).toBe(true)
  })
})
