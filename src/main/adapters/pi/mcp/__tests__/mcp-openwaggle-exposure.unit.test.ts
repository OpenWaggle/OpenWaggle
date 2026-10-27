import type { ExtensionAPI, McpServerConfig, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { Type } from 'typebox'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mcpServerIdentity } from '../../../mcp/pool/mcp-server-identity'
import { forgetMcpAppTools, recordMcpAppTools } from '../mcp-app-registry'
import { withKnownMcpAppToolsOf, withOpenWaggleMcpExposure } from '../mcp-openwaggle-exposure'
import {
  forgetKnownMcpServerStates,
  recordMcpServerToolsListing,
} from '../mcp-server-status-registry'

const SESSION = 'session-1'
const APP_LISTING = {
  tools: [
    { name: 'search', inputSchema: { type: 'object' } },
    {
      name: 'show',
      inputSchema: { type: 'object' },
      _meta: { ui: { resourceUri: 'ui://a/show' } },
    },
  ],
}

afterEach(() => {
  forgetMcpAppTools(SESSION)
  forgetKnownMcpServerStates()
})

/** A definition as Pi's MCP extension registers it (`tools.ts`). */
function mcpTool(server: string, tool: string, exposure: ToolDefinition['exposure']) {
  return fromPartial<ToolDefinition>({
    name: `mcp__${server}__${tool}`,
    label: `${server}/${tool}`,
    description: tool,
    parameters: Type.Object({}),
    exposure,
    namespace: { name: `mcp__${server}`, aliases: [server] },
  })
}

/** Loads `factory` on a fake Pi API and returns what it registered and read. */
function load(
  servers: Parameters<typeof withOpenWaggleMcpExposure>[1]['servers'],
  register: (pi: ExtensionAPI) => void,
  registered: ReturnType<ExtensionAPI['getMcpServers']> = [],
) {
  const registerTool = vi.fn<(definition: ToolDefinition) => void>()
  const pi = fromPartial<ExtensionAPI>({ registerTool, getMcpServers: () => registered })
  void withOpenWaggleMcpExposure(SESSION, { servers }, register)(pi)
  return registerTool.mock.calls.map(([definition]) => [definition.name, definition.exposure])
}

describe("OpenWaggle's MCP exposure on Pi's MCP extension", () => {
  it('declares an App tool of a codemode server when Pi registers it, and nothing else', () => {
    recordMcpAppTools(SESSION, 'apps', APP_LISTING)
    const servers = [
      { name: 'apps', config: { command: 'apps-mcp', exposure: 'codemode' as const }, source: 'f' },
      {
        name: 'off',
        config: { command: 'off-mcp', toolExposure: { show: 'hidden' as const } },
        source: 'f',
      },
    ]

    const calls = load(servers, (pi) => {
      pi.registerTool(mcpTool('apps', 'search', 'deferred'))
      pi.registerTool(mcpTool('apps', 'show', 'deferred'))
      // Pi hides a tool by registering it again as hidden: that stays hidden.
      pi.registerTool(mcpTool('apps', 'show', 'hidden'))
      pi.registerTool(mcpTool('off', 'show', 'hidden'))
    })

    expect(calls).toEqual([
      ['mcp__apps__search', 'deferred'],
      ['mcp__apps__show', 'direct'],
      ['mcp__apps__show', 'hidden'],
      ['mcp__off__show', 'hidden'],
    ])
  })

  it('runs a direct server a Pi extension registered as codemode, and declares its App tool', () => {
    recordMcpAppTools(SESSION, 'ext', APP_LISTING)
    let seen: unknown
    const calls = load(
      [],
      (pi) => {
        seen = pi.getMcpServers().map((server) => server.config)
        pi.registerTool(mcpTool('ext', 'search', 'deferred'))
        pi.registerTool(mcpTool('ext', 'show', 'deferred'))
      },
      [{ name: 'ext', config: { command: 'ext-mcp', exposure: 'direct' }, extensionPath: 'x.ts' }],
    )

    expect(seen).toEqual([{ command: 'ext-mcp', exposure: 'codemode' }])
    expect(calls).toEqual([
      ['mcp__ext__search', 'deferred'],
      ['mcp__ext__show', 'direct'],
    ])
  })

  it('gives Pi the App tools known when the Run starts, from this Session or the last listing', () => {
    recordMcpAppTools(SESSION, 'mine', APP_LISTING)
    const elsewhere: McpServerConfig = { command: 'elsewhere-mcp' }
    recordMcpServerToolsListing(mcpServerIdentity('elsewhere', elsewhere), {}, APP_LISTING)

    const loaded = withKnownMcpAppToolsOf(SESSION, {
      servers: [
        { name: 'mine', config: { command: 'mine-mcp' } satisfies McpServerConfig, source: 'f' },
        { name: 'elsewhere', config: elsewhere, source: 'f' },
        { name: 'plain', config: { command: 'plain-mcp' } satisfies McpServerConfig, source: 'f' },
      ],
    })

    expect(loaded.servers.map((server) => server.config.toolExposure)).toEqual([
      { show: 'direct' },
      { show: 'direct' },
      undefined,
    ])
  })
})
