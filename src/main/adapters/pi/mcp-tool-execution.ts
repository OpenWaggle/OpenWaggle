import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import type { McpGatewayInput, McpGatewayResult, McpJsonValue } from '@shared/types/mcp'
import type { McpRuntimeInteractions } from '../../ports/mcp-runtime-service'
import { createPiMcpRuntimeInteractions } from './mcp-client-interactions'

export type ExecuteGateway = (
  request: McpGatewayInput,
  signal?: AbortSignal,
  interactions?: McpRuntimeInteractions,
) => Promise<McpGatewayResult>

function toJsonValue(value: unknown): McpJsonValue {
  if (value === undefined) return null
  const parsed: unknown = JSON.parse(JSON.stringify(value))
  return decodeUnknownOrThrow(mcpConfigValueSchema, parsed)
}

export function textResult(result: McpGatewayResult) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    details: { kind: 'gateway' as const, result },
    ...(result.isError ? { isError: true as const } : {}),
  }
}

async function showToolCallApproval(input: {
  readonly describe: McpGatewayResult
  readonly arguments: Readonly<Record<string, unknown>>
  readonly ctx: ExtensionContext
  readonly signal?: AbortSignal
}) {
  const tool = input.describe.tools?.[0]
  const attribution = input.describe.attribution
  if (!tool || !attribution) throw new Error('MCP tool description is missing attribution.')
  if (!input.ctx.hasUI) {
    throw new Error('MCP tool execution requires an interactive OpenWaggle approval.')
  }
  return input.ctx.ui.confirm(
    'Allow MCP tool call?',
    [
      `Server: ${attribution.serverLabel}`,
      `Tool: ${tool.title} (${attribution.toolName})`,
      `Arguments: ${JSON.stringify(input.arguments, null, MCP_CONFIG.JSON_INDENT_SPACES)}`,
      '',
      'This approval applies only to this call.',
    ].join('\n'),
    { signal: input.signal },
  )
}

export async function approveMcpCall(input: {
  readonly handle: string
  readonly arguments: Readonly<Record<string, unknown>>
  readonly executeGateway: ExecuteGateway
  readonly ctx: ExtensionContext
  readonly signal?: AbortSignal
}) {
  return (await reviewMcpCall(input)).approved
}

export async function reviewMcpCall(input: {
  readonly handle: string
  readonly arguments: Readonly<Record<string, unknown>>
  readonly executeGateway: ExecuteGateway
  readonly ctx: ExtensionContext
  readonly signal?: AbortSignal
}) {
  const describe = await input.executeGateway(
    { operation: 'describe', handle: input.handle },
    input.signal,
  )
  const approved = await showToolCallApproval({
    describe,
    arguments: input.arguments,
    ctx: input.ctx,
    signal: input.signal,
  })
  return { approved, describe }
}

export function executeMcpToolCall(input: {
  readonly handle: string
  readonly arguments: Readonly<Record<string, unknown>>
  readonly executeGateway: ExecuteGateway
  readonly ctx?: ExtensionContext
  readonly signal?: AbortSignal
}) {
  return input.executeGateway(
    { operation: 'call', handle: input.handle, arguments: toJsonValue(input.arguments) },
    input.signal,
    input.ctx ? createPiMcpRuntimeInteractions(input.ctx) : undefined,
  )
}

export async function executeApprovedCall(input: {
  readonly handle: string
  readonly arguments: Readonly<Record<string, unknown>>
  readonly executeGateway: ExecuteGateway
  readonly ctx: ExtensionContext
  readonly signal?: AbortSignal
}) {
  const approved = await approveMcpCall(input)
  if (!approved) return null
  return executeMcpToolCall(input)
}
