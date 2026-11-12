import { Schema } from '@shared/schema'
import { Option } from 'effect'
/** What a check reads from a server's answer: whether it needs sign-in, and its tools. */
import { getMcpToolExposure, type McpServerEntry } from '@earendil-works/pi-coding-agent'
import type { McpClient } from '@earendil-works/pi-mcp'
import type { McpServerToolView } from '@shared/types/mcp-configuration'
import { mcpToolMetaSchema } from './mcp-tool-list-schema'

export function needsSignIn(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'McpAuthRequiredError' || error.name === 'McpOAuthAuthorizationRequiredError')
  )
}

const decodeToolMeta = Schema.decodeUnknownOption(mcpToolMetaSchema)

export function toolViews(
  entry: McpServerEntry,
  tools: Awaited<ReturnType<McpClient['listTools']>>,
): McpServerToolView[] {
  return tools.map((tool) => {
    const resourceUri = Option.getOrUndefined(decodeToolMeta(tool._meta))?.ui?.resourceUri
    return {
      name: tool.name,
      ...(tool.title ? { title: tool.title } : {}),
      ...(tool.description ? { description: tool.description } : {}),
      exposure: getMcpToolExposure(entry.config, tool.name),
      hasApp: typeof resourceUri === 'string' && resourceUri.startsWith('ui://'),
    }
  })
}
