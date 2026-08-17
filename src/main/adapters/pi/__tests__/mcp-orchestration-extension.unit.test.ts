import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { McpGatewayInput, McpGatewayResult } from '@shared/types/mcp'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { registerMcpOrchestrationTool } from '../mcp-orchestration-extension'

function describeResult(handle: string): McpGatewayResult {
  return {
    operation: 'describe',
    text: 'described',
    tools: [{ handle, title: `Tool ${handle}`, inputSchema: { type: 'object' } }],
    attribution: {
      serverInstanceId: 'server-1',
      serverLabel: 'Test server',
      toolName: `tool_${handle}`,
    },
  }
}

function context(confirm: ExtensionContext['ui']['confirm']) {
  return fromPartial<ExtensionContext>({ hasUI: true, ui: { confirm } })
}

function register(
  executeGateway: (request: McpGatewayInput, signal?: AbortSignal) => Promise<McpGatewayResult>,
) {
  let tool: ToolDefinition | undefined
  registerMcpOrchestrationTool(
    fromPartial<ExtensionAPI>({
      registerTool: (registered: ToolDefinition) => (tool = registered),
    }),
    executeGateway,
  )
  if (!tool) throw new Error('mcp_run was not registered.')
  return tool
}

function outputJson(result: Awaited<ReturnType<ToolDefinition['execute']>>) {
  const content = result.content[0]
  if (content?.type !== 'text') throw new Error('Expected text output.')
  const parsed: unknown = JSON.parse(content.text)
  return parsed
}

describe('Pi MCP orchestration extension', () => {
  it('passes sequential result data into later calls and returns the selected value', async () => {
    const executeGateway = vi.fn(async (request: McpGatewayInput): Promise<McpGatewayResult> => {
      if (request.operation === 'describe') return describeResult(request.handle ?? '')
      if (request.handle === 'first-handle') {
        return { operation: 'call' as const, text: 'first', result: { matches: 7 } }
      }
      expect(request.arguments).toEqual({ previous: 7 })
      return { operation: 'call' as const, text: 'second', result: { value: 'chosen' } }
    })
    const confirm = vi.fn<ExtensionContext['ui']['confirm']>(async () => true)
    const tool = register(executeGateway)

    const result = await tool.execute(
      'run-1',
      {
        code: `
          const first = await mcp.call("first", "first-handle", {});
          if (first.status === "completed") {
            const second = await mcp.call("second", "second-handle", {
              previous: first.result.result.matches
            });
            return { selected: second.result.result.value };
          } else {
            return { selected: null };
          }
        `,
      },
      undefined,
      undefined,
      context(confirm),
    )

    expect(confirm).toHaveBeenCalledTimes(2)
    expect(outputJson(result)).toMatchObject({
      summary: { completed: 2, failed: 0, denied: 0 },
      return: { selected: 'chosen' },
    })
  })

  it('reports a denied child with provenance and never executes it', async () => {
    const executeGateway = vi.fn(async (request: McpGatewayInput) =>
      describeResult(request.handle ?? ''),
    )
    const tool = register(executeGateway)

    const result = await tool.execute(
      'run-1',
      { code: 'const denied = await mcp.call("denied", "opaque-handle", {}); return denied;' },
      undefined,
      undefined,
      context(async () => false),
    )

    expect(executeGateway).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ isError: true })
    expect(outputJson(result)).toMatchObject({
      summary: { denied: 1 },
      results: [
        {
          id: 'denied',
          status: 'denied',
          provenance: {
            handle: 'opaque-handle',
            serverInstanceId: 'server-1',
            serverLabel: 'Test server',
            toolName: 'tool_opaque-handle',
          },
        },
      ],
    })
  })

  it('ends the run when cancelled even if a child ignores its abort signal', async () => {
    let notifyCallStarted: (() => void) | undefined
    const callStarted = new Promise<void>((resolve) => {
      notifyCallStarted = resolve
    })
    const executeGateway = vi.fn(async (request: McpGatewayInput) => {
      if (request.operation === 'describe') return describeResult(request.handle ?? '')
      notifyCallStarted?.()
      return new Promise<McpGatewayResult>(() => undefined)
    })
    const tool = register(executeGateway)
    const controller = new AbortController()
    const execution = tool.execute(
      'run-1',
      { code: 'const result = await mcp.call("child", "handle", {});' },
      controller.signal,
      undefined,
      context(async () => true),
    )

    await callStarted
    controller.abort()

    await expect(execution).rejects.toThrow('wall time or was cancelled')
  })

  it('runs parallel children concurrently without exceeding the hard cap', async () => {
    let started = 0
    let active = 0
    let peak = 0
    let batchResolvers: (() => void)[] = []
    const executeGateway = vi.fn(async (request: McpGatewayInput) => {
      if (request.operation === 'describe') return describeResult(request.handle ?? '')
      started += 1
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => {
        batchResolvers.push(resolve)
        if (active === 8 || started === 10) {
          const resolvers = batchResolvers
          batchResolvers = []
          for (const release of resolvers) release()
        }
      })
      active -= 1
      return { operation: 'call' as const, text: 'completed', result: { ok: true } }
    })
    const confirm = vi.fn<ExtensionContext['ui']['confirm']>(async () => true)
    const tool = register(executeGateway)
    const names = Array.from({ length: 10 }, (_, index) => `result_${String(index)}`)
    const calls = Array.from(
      { length: 10 },
      (_, index) => `mcp.call("id-${String(index)}", "handle-${String(index)}", {})`,
    )

    const result = await tool.execute(
      'run-1',
      { code: `const [${names.join(', ')}] = await mcp.parallel([${calls.join(', ')}]);` },
      undefined,
      undefined,
      context(confirm),
    )

    expect(confirm).toHaveBeenCalledTimes(10)
    expect(peak).toBe(8)
    expect(outputJson(result)).toMatchObject({ summary: { completed: 10 } })
  })
})
