/**
 * Repairs MCP tool input schemas that some providers reject.
 *
 * Pi's MCP extension registers a server's `inputSchema` as the tool's parameters and only forces
 * an object root, so a root `anyOf`/`oneOf`/`$ref` reaches the provider unchanged: Bedrock and
 * OpenAI refuse the whole request, and OpenAI-completions providers send empty arguments. The
 * transport layer rewrites each `tools/list` result before Pi's client reads it, using the same
 * repair as OpenWaggle's own tools. The server still validates the arguments it receives.
 */
import { isRecord } from '@shared/utils/validation'
import { createLogger } from '../../../logger'
import { providerToolParameters } from '../provider-tool-parameter-schema'

const logger = createLogger('mcp-tool-schema')

function repairTool(serverName: string, tool: unknown) {
  if (!isRecord(tool)) return tool
  const { schema, repairs } = providerToolParameters(tool.inputSchema)
  if (repairs.length === 0) return tool
  logger.debug('Repaired an MCP tool input schema for providers', {
    server: serverName,
    tool: typeof tool.name === 'string' ? tool.name : undefined,
    repairs,
  })
  return { ...tool, inputSchema: schema }
}

/** A `tools/list` result whose tools have provider-safe input schemas; other results unchanged. */
export function repairMcpToolListResult(serverName: string, method: string, result: unknown) {
  if (method !== 'tools/list' || !isRecord(result) || !Array.isArray(result.tools)) return result
  return { ...result, tools: result.tools.map((tool) => repairTool(serverName, tool)) }
}
