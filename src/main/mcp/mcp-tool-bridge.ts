import type { McpToolInfo } from '@shared/types/mcp'
import type { ServerTool } from '@tanstack/ai'
import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import { createLogger } from '../logger'
import type { McpClient } from './mcp-client'

const logger = createLogger('mcp-tool-bridge')

/**
 * Convert an MCP tool into a TanStack AI ServerTool.
 * All MCP tools require approval since they execute external code.
 */
export function bridgeMcpTool(tool: McpToolInfo, client: McpClient): ServerTool {
  const def = toolDefinition({
    name: tool.namespacedName,
    description: `[${tool.serverName}] ${tool.description}`,
    needsApproval: true,
    inputSchema: tool.inputSchema,
  })

  return def.server(async (args: unknown) => {
    const parseResult = z.record(z.string(), z.unknown()).safeParse(args)
    const parsedArgs = parseResult.success ? parseResult.data : {}

    logger.info('mcp-tool:call', {
      server: tool.serverName,
      tool: tool.name,
      namespaced: tool.namespacedName,
    })

    const startTime = Date.now()
    try {
      const result = await client.callTool(tool.name, parsedArgs)
      const durationMs = Date.now() - startTime
      logger.info('mcp-tool:result', {
        server: tool.serverName,
        tool: tool.name,
        durationMs,
        resultLength: result.length,
      })
      return result
    } catch (err) {
      const durationMs = Date.now() - startTime
      const message = err instanceof Error ? err.message : String(err)
      logger.error('mcp-tool:error', {
        server: tool.serverName,
        tool: tool.name,
        durationMs,
        error: message,
      })
      throw err
    }
  })
}
