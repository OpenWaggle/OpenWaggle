import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { McpGatewayResult, McpJsonValue } from '@shared/types/mcp'
import { Type } from 'typebox'
import { compileLegacyMcpOrchestration } from './mcp-orchestration-legacy'
import { parseMcpOrchestration } from './mcp-orchestration-parser'
import {
  executeMcpOrchestrationProgram,
  type McpOrchestrationChildResult,
  type McpOrchestrationInvocation,
} from './mcp-orchestration-runtime'
import { type ExecuteGateway, executeMcpToolCall, reviewMcpCall } from './mcp-tool-execution'

const orchestrationCall = Type.Object({
  id: Type.String({ description: 'Unique activity id for this call.' }),
  handle: Type.String({ description: 'Opaque MCP tool handle.' }),
  arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

const orchestrationParameters = Type.Union([
  Type.Object({
    code: Type.String({
      maxLength: MCP_CONFIG.MAX_ORCHESTRATION_SOURCE_BYTES,
      description: 'Restricted JavaScript-like orchestration source. See the mcp_run grammar.',
    }),
  }),
  Type.Object({
    mode: Type.Union([Type.Literal('sequential'), Type.Literal('parallel')]),
    calls: Type.Array(orchestrationCall, {
      minItems: 1,
      maxItems: MCP_CONFIG.MAX_ORCHESTRATION_CALLS,
    }),
  }),
])

type McpCallReview = Awaited<ReturnType<typeof reviewMcpCall>>

function provenance(handle: string, gatewayResult?: McpGatewayResult) {
  return { handle, ...gatewayResult?.attribution }
}

async function reviewedCall(input: {
  readonly call: McpOrchestrationInvocation
  readonly executeGateway: ExecuteGateway
  readonly context: ExtensionContext
  readonly signal: AbortSignal
  readonly review?: McpCallReview
}): Promise<McpOrchestrationChildResult> {
  const { call } = input
  let review = input.review
  try {
    input.signal.throwIfAborted()
    review ??= await reviewMcpCall({
      handle: call.handle,
      arguments: call.arguments,
      executeGateway: input.executeGateway,
      ctx: input.context,
      signal: input.signal,
    })
    if (!review.approved) {
      return {
        id: call.id,
        handle: call.handle,
        status: 'denied',
        provenance: provenance(call.handle, review.describe),
      }
    }
    input.signal.throwIfAborted()
    const result = await executeMcpToolCall({
      handle: call.handle,
      arguments: call.arguments,
      executeGateway: input.executeGateway,
      ctx: input.context,
      signal: input.signal,
    })
    return {
      id: call.id,
      handle: call.handle,
      status: result.isError ? 'failed' : 'completed',
      provenance: provenance(call.handle, result.attribution ? result : review.describe),
      result,
      ...(result.isError ? { error: result.text } : {}),
    }
  } catch (error) {
    return {
      id: call.id,
      handle: call.handle,
      status: 'failed',
      provenance: provenance(call.handle, review?.describe),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function reviewParallelCalls(input: {
  readonly calls: readonly McpOrchestrationInvocation[]
  readonly executeGateway: ExecuteGateway
  readonly context: ExtensionContext
  readonly signal: AbortSignal
}) {
  const reviews: (McpCallReview | McpOrchestrationChildResult)[] = []
  async function reviewNext(index: number): Promise<void> {
    const call = input.calls[index]
    if (!call) return
    try {
      reviews.push(
        await reviewMcpCall({
          handle: call.handle,
          arguments: call.arguments,
          executeGateway: input.executeGateway,
          ctx: input.context,
          signal: input.signal,
        }),
      )
    } catch (error) {
      reviews.push({
        id: call.id,
        handle: call.handle,
        status: 'failed',
        provenance: provenance(call.handle),
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return reviewNext(index + 1)
  }
  await reviewNext(0)
  return reviews
}

function isChildResult(
  value: McpCallReview | McpOrchestrationChildResult,
): value is McpOrchestrationChildResult {
  return 'status' in value
}

async function executeParallel(input: {
  readonly calls: readonly McpOrchestrationInvocation[]
  readonly executeGateway: ExecuteGateway
  readonly context: ExtensionContext
  readonly signal: AbortSignal
  readonly onResult: (result: McpOrchestrationChildResult) => void
}) {
  const reviews = await reviewParallelCalls(input)
  const results: McpOrchestrationChildResult[] = []
  for (let index = 0; index < input.calls.length; index += MCP_CONFIG.MAX_CONCURRENT_CALLS) {
    const batch = input.calls.slice(index, index + MCP_CONFIG.MAX_CONCURRENT_CALLS)
    const completed = await Promise.all(
      batch.map(async (call, batchIndex) => {
        const review = reviews[index + batchIndex]
        const result =
          review && isChildResult(review) ? review : await reviewedCall({ ...input, call, review })
        input.onResult(result)
        return result
      }),
    )
    results.push(...completed)
  }
  return results
}

function programFromParameters(params: {
  readonly code?: string
  readonly mode?: 'sequential' | 'parallel'
  readonly calls?: readonly {
    readonly id: string
    readonly handle: string
    readonly arguments?: Readonly<Record<string, unknown>>
  }[]
}) {
  if (params.code !== undefined) return parseMcpOrchestration(params.code)
  if (!params.mode || !params.calls) throw new Error('MCP run requires code or a legacy plan.')
  return compileLegacyMcpOrchestration({ mode: params.mode, calls: params.calls })
}

function resultText(input: {
  readonly return: McpJsonValue
  readonly results: readonly McpOrchestrationChildResult[]
}) {
  return JSON.stringify({
    summary: {
      completed: input.results.filter((result) => result.status === 'completed').length,
      failed: input.results.filter((result) => result.status === 'failed').length,
      denied: input.results.filter((result) => result.status === 'denied').length,
    },
    return: input.return,
    results: input.results,
  })
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new Error('MCP orchestration was cancelled.'))
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new Error('MCP orchestration exceeded its wall time or was cancelled.'))
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export function registerMcpOrchestrationTool(pi: ExtensionAPI, executeGateway: ExecuteGateway) {
  pi.registerTool({
    name: 'mcp_run',
    label: 'MCP run',
    description:
      'Run restricted JavaScript-like MCP orchestration with variables, conditions, and bounded parallel calls. No eval, runtime, filesystem, process, module, timer, or ambient network authority. Every child call is approved and attributed separately. The legacy JSON plan remains accepted for compatibility.',
    parameters: orchestrationParameters,
    executionMode: 'sequential',
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const progress = new Map<string, McpOrchestrationChildResult>()
      const publish = (result: McpOrchestrationChildResult) => {
        progress.set(result.id, result)
        onUpdate?.({
          content: [{ type: 'text', text: `MCP child ${result.id}: ${result.status}.` }],
          details: { kind: 'orchestration', result: [...progress.values()] },
        })
      }
      onUpdate?.({
        content: [{ type: 'text', text: 'MCP orchestration is awaiting child approvals.' }],
        details: { kind: 'orchestration', result: [] },
      })
      const timeout = AbortSignal.timeout(MCP_CONFIG.MAX_ORCHESTRATION_WALL_TIME_MS)
      const operationSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
      const program = programFromParameters(params)
      const output = await raceWithAbort(
        executeMcpOrchestrationProgram({
          program,
          signal: operationSignal,
          host: {
            call: async (call) => {
              const result = await reviewedCall({
                call,
                executeGateway,
                context: ctx,
                signal: operationSignal,
              })
              publish(result)
              return result
            },
            parallel: (calls) =>
              executeParallel({
                calls,
                executeGateway,
                context: ctx,
                signal: operationSignal,
                onResult: publish,
              }),
          },
        }),
        operationSignal,
      )
      return {
        content: [{ type: 'text', text: resultText(output) }],
        details: { kind: 'orchestration', result: output.results },
        ...(output.results.some((result) => result.status !== 'completed')
          ? { isError: true }
          : {}),
      }
    },
  })
}
