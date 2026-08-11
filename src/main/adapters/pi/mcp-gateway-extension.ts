import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { McpDirectToolDescriptor, McpTurnSnapshot } from '@shared/types/mcp'
import { Type } from 'typebox'
import { registerMcpDirectTools } from './mcp-direct-tools-extension'
import { registerMcpOrchestrationTool } from './mcp-orchestration-extension'
import { type ExecuteGateway, executeApprovedCall, textResult } from './mcp-tool-execution'

const gatewayParameters = Type.Object({
  operation: Type.Union([
    Type.Literal('list'),
    Type.Literal('search'),
    Type.Literal('describe'),
    Type.Literal('call'),
  ]),
  query: Type.Optional(Type.String({ description: 'Search query for operation=search.' })),
  handle: Type.Optional(
    Type.String({ description: 'Opaque handle returned by list/search/describe.' }),
  ),
  arguments: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: 'JSON arguments for operation=call.',
    }),
  ),
})

export function createMcpGatewayExtension(input: {
  readonly snapshot: McpTurnSnapshot
  readonly executeGateway: ExecuteGateway
  readonly directTools?: readonly McpDirectToolDescriptor[]
}): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: 'mcp',
      label: 'MCP',
      description:
        'Discover and invoke explicitly enabled MCP capabilities through opaque handles. Use list or search, then describe, then call. No server tools are injected directly.',
      promptSnippet: 'Discover MCP capabilities through a compact, permissioned gateway.',
      parameters: gatewayParameters,
      executionMode: 'parallel',
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        if (params.operation !== 'call') {
          return textResult(
            await input.executeGateway(
              {
                operation: params.operation,
                ...(params.query ? { query: params.query } : {}),
                ...(params.handle ? { handle: params.handle } : {}),
              },
              signal,
            ),
          )
        }
        if (!params.handle) throw new Error('MCP call requires a handle.')
        const result = await executeApprovedCall({
          handle: params.handle,
          arguments: params.arguments ?? {},
          executeGateway: input.executeGateway,
          ctx,
          signal,
        })
        if (result) return textResult(result)
        return {
          content: [{ type: 'text', text: 'MCP tool call was denied by the user.' }],
          details: { kind: 'gateway', result: null },
          isError: true,
        }
      },
    })
    registerMcpOrchestrationTool(pi, input.executeGateway)
    registerMcpDirectTools(pi, input.directTools ?? [], input.executeGateway)
  }
}
