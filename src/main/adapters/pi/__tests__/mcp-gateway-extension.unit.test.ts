import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type {
  McpDirectToolDescriptor,
  McpGatewayInput,
  McpGatewayResult,
  McpTurnSnapshot,
} from '@shared/types/mcp'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { createMcpGatewayExtension } from '../mcp-gateway-extension'

const SNAPSHOT: McpTurnSnapshot = {
  id: 'snapshot-1',
  sessionId: 'session-1',
  projectPath: '/project',
  revision: 'revision-1',
  createdAt: 1,
  effectiveState: 'on',
  servers: [],
}

async function registeredTools(
  executeGateway: (request: McpGatewayInput, signal?: AbortSignal) => Promise<McpGatewayResult>,
  directTools: readonly McpDirectToolDescriptor[] = [],
) {
  const tools = new Map<string, ToolDefinition>()
  const factory = createMcpGatewayExtension({ snapshot: SNAPSHOT, executeGateway, directTools })
  await factory(
    fromPartial<ExtensionAPI>({
      registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    }),
  )
  return tools
}

function context(confirm: ExtensionContext['ui']['confirm']) {
  return fromPartial<ExtensionContext>({
    hasUI: true,
    ui: { confirm },
  })
}

function describeResult(handle: string): McpGatewayResult {
  return {
    operation: 'describe',
    text: 'described',
    tools: [{ handle, title: 'Search documentation', inputSchema: { type: 'object' } }],
    attribution: {
      serverInstanceId: 'server-1',
      serverLabel: 'Documentation',
      toolName: 'search_docs',
    },
  }
}

describe('Pi MCP gateway extension', () => {
  it('registers only compact gateway schemas without server or tool names', async () => {
    const tools = await registeredTools(async () => ({ operation: 'list', text: 'none' }))

    expect([...tools.keys()]).toEqual(['mcp', 'mcp_run'])
    const visibleDefinitions = [...tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }))
    expect(JSON.stringify(visibleDefinitions)).not.toContain('Documentation')
    expect(JSON.stringify(visibleDefinitions)).not.toContain('search_docs')
  })

  it('shows exact server, tool, and arguments before every MCP call', async () => {
    const executeGateway = vi.fn(async (request: McpGatewayInput) =>
      request.operation === 'describe'
        ? describeResult(request.handle ?? '')
        : {
            operation: 'call' as const,
            text: 'completed',
            result: { matches: 1 },
          },
    )
    const confirm = vi.fn<ExtensionContext['ui']['confirm']>(async () => true)
    const tools = await registeredTools(executeGateway)
    const gateway = tools.get('mcp')

    await gateway?.execute(
      'tool-call-1',
      { operation: 'call', handle: 'mcp_handle', arguments: { query: 'MCP' } },
      undefined,
      undefined,
      context(confirm),
    )

    expect(confirm).toHaveBeenCalledWith(
      'Allow MCP tool call?',
      expect.stringContaining('Server: Documentation'),
      { signal: undefined },
    )
    expect(confirm.mock.calls[0]?.[1]).toContain('Tool: Search documentation (search_docs)')
    expect(confirm.mock.calls[0]?.[1]).toContain('"query": "MCP"')
    expect(executeGateway).toHaveBeenLastCalledWith(
      { operation: 'call', handle: 'mcp_handle', arguments: { query: 'MCP' } },
      undefined,
      expect.objectContaining({ elicit: expect.any(Function), sample: expect.any(Function) }),
    )
  })

  it('does not execute a call when the user denies it', async () => {
    const executeGateway = vi.fn(async (request: McpGatewayInput) =>
      describeResult(request.handle ?? ''),
    )
    const tools = await registeredTools(executeGateway)
    const result = await tools.get('mcp')?.execute(
      'tool-call-1',
      { operation: 'call', handle: 'mcp_handle', arguments: {} },
      undefined,
      undefined,
      context(async () => false),
    )

    expect(executeGateway).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ isError: true })
  })

  it('asks separately before each child in a bounded MCP run', async () => {
    const executeGateway = vi.fn(async (request: McpGatewayInput) =>
      request.operation === 'describe'
        ? describeResult(request.handle ?? '')
        : { operation: 'call' as const, text: 'completed', result: { ok: true } },
    )
    const confirm = vi.fn<ExtensionContext['ui']['confirm']>(async () => true)
    const tools = await registeredTools(executeGateway)

    const result = await tools.get('mcp_run')?.execute(
      'tool-call-1',
      {
        mode: 'sequential',
        calls: [
          { id: 'first', handle: 'mcp_1', arguments: { value: 1 } },
          { id: 'second', handle: 'mcp_2', arguments: { value: 2 } },
        ],
      },
      undefined,
      undefined,
      context(confirm),
    )

    expect(confirm).toHaveBeenCalledTimes(2)
    expect(result?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('"completed":2'),
    })
  })

  it('registers explicitly selected direct tools with their real schema and the same approval path', async () => {
    const executeGateway = vi.fn(async (request: McpGatewayInput) =>
      request.operation === 'describe'
        ? describeResult(request.handle ?? '')
        : { operation: 'call' as const, text: 'completed', result: { matches: 1 } },
    )
    const directTool = {
      modelName: 'mcp_documentation_search_docs_a1b2c3d4',
      handle: 'mcp_handle',
      title: 'Search documentation',
      description: 'Search private documentation.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      serverLabel: 'Documentation',
    } satisfies McpDirectToolDescriptor
    const confirm = vi.fn<ExtensionContext['ui']['confirm']>(async () => true)
    const tools = await registeredTools(executeGateway, [directTool])
    const registered = tools.get(directTool.modelName)

    expect(registered?.parameters).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string' } },
    })
    await registered?.execute(
      'direct-call',
      { query: 'MCP' },
      undefined,
      undefined,
      context(confirm),
    )
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(executeGateway).toHaveBeenLastCalledWith(
      { operation: 'call', handle: 'mcp_handle', arguments: { query: 'MCP' } },
      undefined,
      expect.objectContaining({ elicit: expect.any(Function), sample: expect.any(Function) }),
    )
  })
})
