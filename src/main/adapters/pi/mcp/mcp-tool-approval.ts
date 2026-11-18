import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { getOpenWaggleAuthorize } from '../agent-kernel/openwaggle-authorize-channel'

export interface McpToolApprovalRequest {
  readonly ctx: ExtensionContext
  readonly serverName: string
  /** `mcpServerIdentity`: the server name with what it runs, so a reused name gets no grants. */
  readonly serverIdentity: string
  /** Pi's tool name, `mcp__<server>__<tool>`. */
  readonly toolName: string
  readonly input: Readonly<Record<string, unknown>>
  /** Set when a codemode script made the call. */
  readonly fromScript: boolean
}

function displayToolName(toolName: string, serverName: string) {
  const prefix = `mcp__${serverName.replace(/[^A-Za-z0-9_]/g, '_')}__`
  return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName
}

/**
 * Asks the user before an MCP tool runs, whether the model called it directly or a codemode
 * script did. Declared as authorization and keyed on the server and the exact tool, never the
 * arguments, so a remembered approval covers this tool and nothing else, and an access mode
 * answers it the same way as any other authorization.
 */
export async function approveMcpToolCall(request: McpToolApprovalRequest) {
  const tool = displayToolName(request.toolName, request.serverName)
  const title = 'Allow MCP tool call?'
  const message = [
    `Server: ${request.serverName}`,
    `Tool: ${tool}${request.fromScript ? ' (called from a codemode script)' : ''}`,
    `Arguments: ${JSON.stringify(request.input, null, MCP_CONFIG.JSON_INDENT_SPACES)}`,
  ].join('\n')
  const authorize = getOpenWaggleAuthorize(request.ctx.ui)
  if (authorize) {
    return authorize({
      title,
      message,
      scopeKey: {
        requesterId: request.serverIdentity,
        requester: request.serverName,
        capability: 'mcp.tool-call',
        resource: request.toolName,
      },
      ...(request.ctx.signal ? { signal: request.ctx.signal } : {}),
    })
  }
  if (!request.ctx.hasUI) return false
  // No OpenWaggle channel, so degrade to always asking rather than to always allowing.
  return request.ctx.ui.confirm(title, `${message}\n\nThis approval applies only to this call.`)
}
