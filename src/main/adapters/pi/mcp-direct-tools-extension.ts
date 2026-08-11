import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { McpDirectToolDescriptor, McpJsonValue } from '@shared/types/mcp'
import { Type } from 'typebox'
import { type ExecuteGateway, executeApprovedCall, textResult } from './mcp-tool-execution'

function isSchemaObject(value: McpJsonValue | undefined): value is Record<string, McpJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parameters(tool: McpDirectToolDescriptor) {
  return isSchemaObject(tool.inputSchema)
    ? Type.Unsafe<Record<string, unknown>>(tool.inputSchema)
    : Type.Record(Type.String(), Type.Unknown())
}

export function registerMcpDirectTools(
  pi: ExtensionAPI,
  tools: readonly McpDirectToolDescriptor[],
  executeGateway: ExecuteGateway,
) {
  for (const tool of tools) {
    pi.registerTool({
      name: tool.modelName,
      label: `${tool.title} · ${tool.serverLabel}`,
      description: `${tool.description ?? tool.title}\n\nProvided by the ${tool.serverLabel} MCP server. Every call requires fresh user approval.`,
      promptSnippet: `Use ${tool.title} from ${tool.serverLabel} when its explicit MCP capability is needed.`,
      parameters: parameters(tool),
      executionMode: 'parallel',
      async execute(_toolCallId, arguments_, signal, _onUpdate, ctx) {
        const result = await executeApprovedCall({
          handle: tool.handle,
          arguments: arguments_,
          executeGateway,
          ctx,
          signal,
        })
        if (!result) {
          return {
            content: [{ type: 'text', text: 'MCP tool call was denied by the user.' }],
            details: { kind: 'gateway', result: null },
            isError: true,
          }
        }
        return textResult(result)
      },
    })
  }
}
