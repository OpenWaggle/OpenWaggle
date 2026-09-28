import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { estimateTokens } from '@earendil-works/pi-coding-agent'
import type {
  McpDirectToolDescriptor,
  McpGatewayInput,
  McpGatewayResult,
  McpTurnSnapshot,
} from '@shared/types/mcp'
import { fromPartial } from '@total-typescript/shoehorn'
import { vi } from 'vitest'
import { createMcpGatewayExtension } from '../mcp-gateway-extension'

export const SNAPSHOT: McpTurnSnapshot = {
  id: 'snapshot-1',
  sessionId: 'session-1',
  projectPath: '/project',
  revision: 'revision-1',
  createdAt: 1,
  effectiveState: 'on',
  servers: [],
}

export const DIRECT_SCREENSHOT_TOOL = {
  modelName: 'mcp_chrome-devtools_take_screenshot_bd31d9df',
  handle: 'mcp_screenshot',
  title: 'take_screenshot',
  serverLabel: 'chrome-devtools',
} satisfies McpDirectToolDescriptor

export const ATTRIBUTION = {
  serverInstanceId: 'server-1',
  serverLabel: 'chrome-devtools',
  toolName: 'take_screenshot',
}

// The incident screenshot was 433,816 base64 characters; keep the fixture in that range so the
// token-budget assertion is meaningful.
export const SCREENSHOT_BASE64 = `iVBORw0KGgo${'A'.repeat(433_800)}`
export const SECOND_SCREENSHOT_BASE64 = `iVBORw0KGgo${'B'.repeat(1_000)}`

export function describeResult(handle: string): McpGatewayResult {
  return {
    operation: 'describe',
    text: 'described',
    tools: [{ handle, title: 'take_screenshot', inputSchema: { type: 'object' } }],
    attribution: ATTRIBUTION,
  }
}

export function gatewayWithCallResult(callResult: McpGatewayResult) {
  return vi.fn(async (request: McpGatewayInput) =>
    request.operation === 'describe' ? describeResult(request.handle ?? '') : callResult,
  )
}

export async function registeredTools(
  executeGateway: (request: McpGatewayInput, signal?: AbortSignal) => Promise<McpGatewayResult>,
): Promise<Map<string, ToolDefinition>> {
  const tools = new Map<string, ToolDefinition>()
  const factory = createMcpGatewayExtension({
    snapshot: SNAPSHOT,
    executeGateway,
    directTools: [DIRECT_SCREENSHOT_TOOL],
  })
  await factory(
    fromPartial<ExtensionAPI>({
      registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    }),
  )
  return tools
}

export function approvingContext() {
  return fromPartial<ExtensionContext>({ hasUI: true, ui: { confirm: async () => true } })
}

export function modelTokenEstimate(result: AgentToolResult<unknown>) {
  return estimateTokens({
    role: 'toolResult',
    toolCallId: 'tool-call-1',
    toolName: DIRECT_SCREENSHOT_TOOL.modelName,
    content: result.content,
    isError: false,
    timestamp: 1,
  })
}

export function textOf(result: AgentToolResult<unknown>) {
  return result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
}

export function screenshotCallResult(): McpGatewayResult {
  return {
    operation: 'call',
    text: 'MCP tool completed.',
    result: [
      { type: 'text', text: 'Took a screenshot of node with uid "1_311".' },
      { type: 'image', data: SCREENSHOT_BASE64, mimeType: 'image/png' },
    ],
    attribution: ATTRIBUTION,
  }
}
