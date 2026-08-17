import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpAppToolCallResult, McpJsonValue, McpTurnSnapshot } from '@shared/types/mcp'
import { Effect } from 'effect'
import {
  McpRuntimeError,
  type McpRuntimeFailure,
  toMcpRuntimeError,
} from '../../../ports/mcp-errors'
import type { McpRuntimeStateService } from './runtime-state'

export function callMcpAppTool(input: {
  readonly state: McpRuntimeStateService
  readonly snapshot: McpTurnSnapshot
  readonly serverInstanceId: string
  readonly toolName: string
  readonly arguments: Readonly<Record<string, McpJsonValue>>
  readonly signal?: AbortSignal
}): Effect.Effect<McpAppToolCallResult, McpRuntimeFailure> {
  return Effect.gen(function* () {
    const tools = yield* input.state.loadCatalog(
      input.snapshot,
      (server) => server.instanceId === input.serverInstanceId,
    )
    const tool = tools.find((candidate) => candidate.tool.name === input.toolName)
    if (!tool)
      return yield* Effect.fail(
        new McpRuntimeError({
          operation: 'callAppTool',
          message: 'The MCP App requested a tool that its server did not advertise.',
        }),
      )
    const result = yield* Effect.tryPromise({
      try: () =>
        tool.connection.callTool({
          name: tool.tool.name,
          arguments: input.arguments,
          signal: input.signal,
        }),
      catch: (error) => toMcpRuntimeError('callAppTool', error),
    })
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MCP_CONFIG.MAX_RESULT_BYTES) {
      return yield* Effect.fail(
        new McpRuntimeError({
          operation: 'callAppTool',
          message: `MCP App tool result exceeded the ${String(MCP_CONFIG.MAX_RESULT_BYTES)} byte safety limit.`,
        }),
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
  })
}
