import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { estimateTokens } from '@earendil-works/pi-coding-agent'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type {
  McpDirectToolDescriptor,
  McpGatewayInput,
  McpGatewayResult,
  McpTurnSnapshot,
} from '@shared/types/mcp'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { createMcpGatewayExtension } from '../mcp-gateway-extension'

const SNAPSHOT: McpTurnSnapshot = {
  id: 'snapshot-1',
  sessionId: 'session-1',
  projectPath: '/project',
  revision: 'revision-1',
  createdAt: 1,
  effectiveState: 'on',
  servers: [],
}

const DIRECT_SCREENSHOT_TOOL = {
  modelName: 'mcp_chrome-devtools_take_screenshot_bd31d9df',
  handle: 'mcp_screenshot',
  title: 'take_screenshot',
  serverLabel: 'chrome-devtools',
} satisfies McpDirectToolDescriptor

const ATTRIBUTION = {
  serverInstanceId: 'server-1',
  serverLabel: 'chrome-devtools',
  toolName: 'take_screenshot',
}

// The incident screenshot was 433,816 base64 characters; keep the fixture in that range so the
// token-budget assertion is meaningful.
const SCREENSHOT_BASE64 = `iVBORw0KGgo${'A'.repeat(433_800)}`
const SECOND_SCREENSHOT_BASE64 = `iVBORw0KGgo${'B'.repeat(1_000)}`

function describeResult(handle: string): McpGatewayResult {
  return {
    operation: 'describe',
    text: 'described',
    tools: [{ handle, title: 'take_screenshot', inputSchema: { type: 'object' } }],
    attribution: ATTRIBUTION,
  }
}

function gatewayWithCallResult(callResult: McpGatewayResult) {
  return vi.fn(async (request: McpGatewayInput) =>
    request.operation === 'describe' ? describeResult(request.handle ?? '') : callResult,
  )
}

async function registeredTools(
  executeGateway: (request: McpGatewayInput, signal?: AbortSignal) => Promise<McpGatewayResult>,
) {
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

function approvingContext() {
  return fromPartial<ExtensionContext>({ hasUI: true, ui: { confirm: async () => true } })
}

function modelTokenEstimate(result: AgentToolResult<unknown>) {
  return estimateTokens({
    role: 'toolResult',
    toolCallId: 'tool-call-1',
    toolName: DIRECT_SCREENSHOT_TOOL.modelName,
    content: result.content,
    isError: false,
    timestamp: 1,
  })
}

function textOf(result: AgentToolResult<unknown>) {
  return result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
}

function screenshotCallResult(): McpGatewayResult {
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

describe('MCP tool result model-facing content', () => {
  it('forwards a direct-tool screenshot as native image content instead of base64 text', async () => {
    const callResult = screenshotCallResult()
    const tools = await registeredTools(gatewayWithCallResult(callResult))

    const result = await tools
      .get(DIRECT_SCREENSHOT_TOOL.modelName)
      ?.execute('tool-call-1', { format: 'png' }, undefined, undefined, approvingContext())

    expect(result).toBeDefined()
    if (!result) return
    expect(result.content).toContainEqual({
      type: 'image',
      data: SCREENSHOT_BASE64,
      mimeType: 'image/png',
    })
    const text = textOf(result)
    expect(text).not.toContain(SCREENSHOT_BASE64.slice(0, 64))
    expect(text).toContain('Took a screenshot of node with uid')
    expect(text).toContain('[image attached to this tool result: image/png]')
    // Before the fix this tool result was ~108k estimated (~271k real) tokens of base64 text.
    expect(modelTokenEstimate(result)).toBeLessThan(2_000)
    // The complete MCP result remains available to MCP Apps, attribution, and the UI.
    expect(result.details).toEqual({ kind: 'gateway', result: callResult })
  })

  it('applies the same conversion to gateway calls and removes duplicated MCP App payloads', async () => {
    const callResult: McpGatewayResult = {
      ...screenshotCallResult(),
      app: {
        descriptor: {
          serverInstanceId: 'server-1',
          serverLabel: 'chrome-devtools',
          serverConfigHash: 'hash',
          toolHandle: 'mcp_screenshot',
          toolName: 'take_screenshot',
          toolTitle: 'take_screenshot',
          resourceUri: 'ui://screenshot',
          allowedNetworkDomains: [],
        },
        toolResult: {
          content: [{ type: 'image', data: SCREENSHOT_BASE64, mimeType: 'image/png' }],
          isError: false,
        },
      },
    }
    const tools = await registeredTools(gatewayWithCallResult(callResult))

    const result = await tools
      .get('mcp')
      ?.execute(
        'tool-call-1',
        { operation: 'call', handle: 'mcp_screenshot', arguments: {} },
        undefined,
        undefined,
        approvingContext(),
      )

    expect(result).toBeDefined()
    if (!result) return
    expect(result.content.filter((block) => block.type === 'image')).toHaveLength(1)
    expect(textOf(result)).not.toContain(SCREENSHOT_BASE64.slice(0, 64))
  })

  it('omits audio, resource blobs, and unsupported image payloads from text without attaching them', async () => {
    const callResult: McpGatewayResult = {
      operation: 'call',
      text: 'MCP tool completed.',
      result: [
        { type: 'audio', data: 'UklGRiQAAABXQVZF', mimeType: 'audio/wav' },
        {
          type: 'resource',
          resource: {
            uri: 'file:///trace.bin',
            mimeType: 'application/octet-stream',
            blob: 'AAEC',
          },
        },
        { type: 'image', data: 'PHN2Zz48L3N2Zz4=', mimeType: 'image/svg+xml' },
      ],
      attribution: ATTRIBUTION,
    }
    const tools = await registeredTools(gatewayWithCallResult(callResult))

    const result = await tools
      .get(DIRECT_SCREENSHOT_TOOL.modelName)
      ?.execute('tool-call-1', {}, undefined, undefined, approvingContext())

    expect(result).toBeDefined()
    if (!result) return
    expect(result.content.every((block) => block.type === 'text')).toBe(true)
    const text = textOf(result)
    expect(text).not.toContain('UklGRiQAAABXQVZF')
    expect(text).not.toContain('"blob":"AAEC"')
    expect(text).not.toContain('PHN2Zz48L3N2Zz4=')
    expect(text).toContain('[audio data omitted from text: 16 base64 characters]')
    expect(text).toContain('[resource blob data omitted from text: 4 base64 characters]')
    expect(text).toContain('file:///trace.bin')
  })

  it('bounds attached images for an MCP run and keeps child results textual', async () => {
    const executeGateway = vi.fn(async (request: McpGatewayInput) =>
      request.operation === 'describe'
        ? describeResult(request.handle ?? '')
        : {
            ...screenshotCallResult(),
            result: [
              {
                type: 'image',
                data: `${SECOND_SCREENSHOT_BASE64}${request.handle ?? ''}`,
                mimeType: 'image/png',
              },
            ],
          },
    )
    const tools = await registeredTools(executeGateway)
    const callCount = MCP_CONFIG.MAX_RESULT_IMAGES + 2
    const calls = Array.from({ length: callCount }, (_, index) => ({
      id: `shot${String(index)}`,
      handle: `mcpshot${String(index)}`,
      arguments: {},
    }))

    const result = await tools
      .get('mcp_run')
      ?.execute(
        'tool-call-1',
        { mode: 'parallel', calls },
        undefined,
        undefined,
        approvingContext(),
      )

    expect(result).toBeDefined()
    if (!result) return
    expect(result.content.filter((block) => block.type === 'image')).toHaveLength(
      MCP_CONFIG.MAX_RESULT_IMAGES,
    )
    const text = textOf(result)
    expect(text).toContain(`"completed":${String(callCount)}`)
    expect(text).not.toContain(SECOND_SCREENSHOT_BASE64)
    expect(text).toContain('limit of 8 attached images reached')
  })
})
