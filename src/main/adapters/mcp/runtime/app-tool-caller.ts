import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpAppToolCallResult, McpJsonValue, McpTurnSnapshot } from '@shared/types/mcp'
import type { McpRuntimeState } from './runtime-state'

export async function callMcpAppTool(input: {
  readonly state: McpRuntimeState
  readonly snapshot: McpTurnSnapshot
  readonly serverInstanceId: string
  readonly toolName: string
  readonly arguments: Readonly<Record<string, McpJsonValue>>
  readonly signal?: AbortSignal
}): Promise<McpAppToolCallResult> {
  const tools = await input.state.loadCatalog(
    input.snapshot,
    (server) => server.instanceId === input.serverInstanceId,
  )
  const tool = tools.find((candidate) => candidate.tool.name === input.toolName)
  if (!tool) throw new Error('The MCP App requested a tool that its server did not advertise.')
  const result = await tool.connection.callTool({
    name: tool.tool.name,
    arguments: input.arguments,
    signal: input.signal,
  })
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MCP_CONFIG.MAX_RESULT_BYTES) {
    throw new Error(
      `MCP App tool result exceeded the ${String(MCP_CONFIG.MAX_RESULT_BYTES)} byte safety limit.`,
    )
  }
  return {
    content: result.content,
    ...(result.structuredContent === undefined
      ? {}
      : { structuredContent: result.structuredContent }),
    isError: result.isError,
    attribution: {
      serverInstanceId: tool.server.instanceId,
      serverLabel: tool.server.name,
      toolName: tool.tool.name,
    },
  }
}
