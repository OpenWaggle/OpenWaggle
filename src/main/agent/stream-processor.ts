import type { StreamChunk } from '@tanstack/ai'
import { createLogger } from '../logger'
import {
  notifyRunError,
  notifyStreamChunk,
  notifyToolCallEnd,
  notifyToolCallStart,
} from './lifecycle-hooks'
import type { AgentLifecycleHook, AgentRunContext } from './runtime-types'
import type { StreamPartCollector } from './stream-part-collector'

const approvalTraceLogger = createLogger('approval-trace')

/**
 * Maximum time (ms) to wait for a new stream chunk before declaring the stream stalled.
 * When exceeded, `processAgentStream` returns with `timedOut: true` so the caller
 * can retry with a fresh stream.
 */
export const STREAM_STALL_TIMEOUT_MS = 120_000

export type StreamStallReason = 'stream-stall' | 'incomplete-tool-call'

export interface ProcessAgentStreamParams {
  readonly stream: AsyncIterable<StreamChunk>
  readonly collector: StreamPartCollector
  readonly onChunk: (chunk: StreamChunk) => void
  readonly signal: AbortSignal
  readonly hooks: readonly AgentLifecycleHook[]
  readonly runContext: AgentRunContext
  readonly approvalTraceEnabled?: boolean
  /** Override stall timeout for testing. Defaults to STREAM_STALL_TIMEOUT_MS. */
  readonly stallTimeoutMs?: number
}

export interface ProcessAgentStreamResult {
  readonly aborted: boolean
  readonly runErrorNotified: boolean
  readonly timedOut: boolean
  readonly stallReason: StreamStallReason | null
}

type NextChunkResult =
  | { readonly kind: 'aborted' }
  | { readonly kind: 'chunk'; readonly iterResult: IteratorResult<StreamChunk> }

interface ForwardChunkParams {
  readonly collector: StreamPartCollector
  readonly onChunk: (chunk: StreamChunk) => void
  readonly hooks: readonly AgentLifecycleHook[]
  readonly runContext: AgentRunContext
}

async function forwardChunk(params: ForwardChunkParams, chunk: StreamChunk): Promise<boolean> {
  params.onChunk(chunk)
  notifyStreamChunk(params.hooks, params.runContext, chunk)

  const collected = params.collector.handleChunk(chunk)
  if (collected.toolCallStart) {
    notifyToolCallStart(params.hooks, params.runContext, collected.toolCallStart)
  }
  if (collected.toolCallEnd) {
    notifyToolCallEnd(params.hooks, params.runContext, collected.toolCallEnd)
  }
  if (collected.runError) {
    await notifyRunError(params.hooks, params.runContext, collected.runError)
    return true
  }

  return false
}

function isApprovalTraceChunk(chunk: StreamChunk): boolean {
  if (chunk.type === 'TOOL_CALL_END') {
    return chunk.result === undefined
  }

  if (chunk.type === 'CUSTOM') {
    return chunk.name === 'approval-requested'
  }

  return chunk.type === 'RUN_FINISHED' || chunk.type === 'RUN_ERROR'
}

function waitForNextChunkOrAbort(
  iterator: AsyncIterator<StreamChunk>,
  signal: AbortSignal,
): Promise<NextChunkResult> {
  if (signal.aborted) {
    return Promise.resolve({ kind: 'aborted' })
  }

  return new Promise<NextChunkResult>((resolve, reject) => {
    let settled = false

    const finish = (result: NextChunkResult): void => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(result)
    }

    const fail = (error: unknown): void => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', onAbort)
      reject(error)
    }

    const onAbort = (): void => {
      finish({ kind: 'aborted' })
    }

    signal.addEventListener('abort', onAbort, { once: true })
    iterator
      .next()
      .then((iterResult) => {
        finish({ kind: 'chunk', iterResult })
      })
      .catch(fail)
  })
}

/**
 * Iterate the agent stream, forwarding chunks and collecting tool call events.
 * Uses manual async iteration with a stall timer — if no chunk arrives within
 * `stallTimeoutMs` the function returns `{ timedOut: true }` so the caller can
 * create a fresh stream and retry.
 */
export async function processAgentStream(
  params: ProcessAgentStreamParams,
): Promise<ProcessAgentStreamResult> {
  const { stream, collector, onChunk, signal, hooks, runContext } = params
  const forwardChunkParams: ForwardChunkParams = { collector, onChunk, hooks, runContext }
  const timeout = params.stallTimeoutMs ?? STREAM_STALL_TIMEOUT_MS
  let aborted = false
  let runErrorNotified = false
  let timedOut = false
  let stallReason: StreamStallReason | null = null
  let approvalTraceActive = params.approvalTraceEnabled ?? false

  const iterator = stream[Symbol.asyncIterator]()
  let stallTimer: ReturnType<typeof setTimeout> | null = null

  try {
    while (true) {
      if (signal.aborted) {
        aborted = true
        break
      }

      if (collector.hasUnresolvedToolResults()) {
        const nextChunkResult = await waitForNextChunkOrAbort(iterator, signal)

        if (nextChunkResult.kind === 'aborted') {
          aborted = true
          break
        }

        if (nextChunkResult.iterResult.done) {
          break
        }

        const chunk = nextChunkResult.iterResult.value
        if (isApprovalTraceChunk(chunk)) {
          approvalTraceActive = true
        }
        if (approvalTraceActive) {
          approvalTraceLogger.info('stream-chunk', {
            runId: runContext.runId,
            conversationId: runContext.conversation.id,
            chunkType: chunk.type,
            toolCallId: chunk.type === 'TOOL_CALL_END' ? chunk.toolCallId : undefined,
            hasResult: chunk.type === 'TOOL_CALL_END' ? chunk.result !== undefined : undefined,
            customName: chunk.type === 'CUSTOM' ? chunk.name : undefined,
          })
        }
        const notifiedRunError = await forwardChunk(forwardChunkParams, chunk)
        if (notifiedRunError) {
          runErrorNotified = true
        }
        continue
      }

      // Race the next chunk against a stall timeout
      const stallPromise = new Promise<{ kind: 'stall' }>((resolve) => {
        stallTimer = setTimeout(() => resolve({ kind: 'stall' }), timeout)
      })

      const result = await Promise.race([
        iterator.next().then((r): { kind: 'chunk'; iterResult: IteratorResult<StreamChunk> } => ({
          kind: 'chunk',
          iterResult: r,
        })),
        stallPromise,
      ])

      // Clear the timer regardless of outcome
      if (stallTimer !== null) {
        clearTimeout(stallTimer)
        stallTimer = null
      }

      if (result.kind === 'stall') {
        timedOut = true
        stallReason = collector.hasIncompleteToolCalls() ? 'incomplete-tool-call' : 'stream-stall'
        break
      }

      if (result.iterResult.done) break

      const chunk = result.iterResult.value
      if (isApprovalTraceChunk(chunk)) {
        approvalTraceActive = true
      }
      if (approvalTraceActive) {
        approvalTraceLogger.info('stream-chunk', {
          runId: runContext.runId,
          conversationId: runContext.conversation.id,
          chunkType: chunk.type,
          toolCallId: chunk.type === 'TOOL_CALL_END' ? chunk.toolCallId : undefined,
          hasResult: chunk.type === 'TOOL_CALL_END' ? chunk.result !== undefined : undefined,
          customName: chunk.type === 'CUSTOM' ? chunk.name : undefined,
        })
      }
      const notifiedRunError = await forwardChunk(forwardChunkParams, chunk)
      if (notifiedRunError) {
        runErrorNotified = true
      }
    }
  } finally {
    if (stallTimer !== null) {
      clearTimeout(stallTimer)
    }
    if (approvalTraceActive) {
      approvalTraceLogger.info('stream-finished', {
        runId: runContext.runId,
        conversationId: runContext.conversation.id,
        aborted,
        timedOut,
        stallReason,
        runErrorNotified,
      })
    }
  }

  return { aborted, runErrorNotified, timedOut, stallReason }
}
