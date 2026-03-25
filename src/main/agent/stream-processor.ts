import type { StreamChunk } from '@tanstack/ai'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { approvalTraceEnabled as runtimeApprovalTraceEnabled } from '../env'
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
export const INCOMPLETE_TOOL_CALL_STALL_TIMEOUT_MS = 30_000

export type StreamStallReason = 'stream-stall' | 'incomplete-tool-args' | 'awaiting-tool-result'

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

function resolveChunkTimeoutMs(collector: StreamPartCollector, defaultTimeoutMs: number): number {
  // Only apply the aggressive 30s timeout when the LLM is still generating tool
  // call arguments (genuinely stalled). When a tool is executing and we're awaiting
  // its result, use the default timeout — tools may legitimately run for minutes.
  if (collector.hasPendingToolCallInputs()) {
    return Math.min(defaultTimeoutMs, INCOMPLETE_TOOL_CALL_STALL_TIMEOUT_MS)
  }
  return defaultTimeoutMs
}

type NextChunkResult =
  | { readonly kind: 'aborted' }
  | { readonly kind: 'chunk'; readonly iterResult: IteratorResult<StreamChunk> }
  | { readonly kind: 'stall' }

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

function forwardChunkEffect(
  params: ForwardChunkParams,
  chunk: StreamChunk,
): Effect.Effect<boolean, unknown> {
  return Effect.tryPromise(() => forwardChunk(params, chunk))
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
): Effect.Effect<NextChunkResult, unknown> {
  return Effect.async<NextChunkResult, unknown>((resume) => {
    if (signal.aborted) {
      resume(Effect.succeed({ kind: 'aborted' }))
      return
    }

    let settled = false

    const finish = (result: NextChunkResult): void => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', onAbort)
      resume(Effect.succeed(result))
    }

    const fail = (error: unknown): void => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', onAbort)
      resume(Effect.fail(error))
    }

    const onAbort = (): void => {
      finish({ kind: 'aborted' })
    }

    signal.addEventListener('abort', onAbort, { once: true })
    void iterator
      .next()
      .then((iterResult) => {
        finish({ kind: 'chunk', iterResult })
      })
      .catch(fail)

    return Effect.sync(() => {
      signal.removeEventListener('abort', onAbort)
    })
  })
}

function waitForNextChunkWithOptionalTimeout(
  iterator: AsyncIterator<StreamChunk>,
  signal: AbortSignal,
  timeoutMs: number,
  shouldWaitIndefinitely: boolean,
): Effect.Effect<NextChunkResult, unknown> {
  const nextChunkEffect = waitForNextChunkOrAbort(iterator, signal)

  if (shouldWaitIndefinitely) {
    return nextChunkEffect
  }

  return Effect.raceFirst(
    nextChunkEffect,
    Effect.sleep(Duration.millis(timeoutMs)).pipe(Effect.as({ kind: 'stall' } as const)),
  )
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
  return Effect.runPromise(processAgentStreamEffect(params))
}

export function processAgentStreamEffect(
  params: ProcessAgentStreamParams,
): Effect.Effect<ProcessAgentStreamResult, unknown> {
  const { stream, collector, onChunk, signal, hooks, runContext } = params
  const conversationId = runContext.conversation?.id
  const forwardChunkParams: ForwardChunkParams = { collector, onChunk, hooks, runContext }
  const timeout = params.stallTimeoutMs ?? STREAM_STALL_TIMEOUT_MS
  let aborted = false
  let runErrorNotified = false
  let timedOut = false
  let stallReason: StreamStallReason | null = null
  let approvalTraceActive = runtimeApprovalTraceEnabled && (params.approvalTraceEnabled ?? false)
  const iterator = stream[Symbol.asyncIterator]()

  const trackApprovalTraceState = (chunk: StreamChunk): void => {
    if (!runtimeApprovalTraceEnabled) {
      return
    }
    if (isApprovalTraceChunk(chunk)) {
      approvalTraceActive = true
    }
  }

  const loop = Effect.gen(function* () {
    while (true) {
      if (signal.aborted) {
        aborted = true
        break
      }

      const nextChunkResult = yield* waitForNextChunkWithOptionalTimeout(
        iterator,
        signal,
        resolveChunkTimeoutMs(collector, timeout),
        collector.shouldBypassStallTimeout(),
      )

      if (nextChunkResult.kind === 'aborted') {
        aborted = true
        break
      }

      if (nextChunkResult.kind === 'stall') {
        timedOut = true
        stallReason = collector.hasPendingToolCallInputs()
          ? 'incomplete-tool-args'
          : collector.hasUnresolvedToolResults()
            ? 'awaiting-tool-result'
            : 'stream-stall'
        break
      }

      if (nextChunkResult.iterResult.done) {
        break
      }

      const chunk = nextChunkResult.iterResult.value
      trackApprovalTraceState(chunk)
      const notifiedRunError = yield* forwardChunkEffect(forwardChunkParams, chunk)
      if (notifiedRunError) {
        runErrorNotified = true
      }
    }

    return { aborted, runErrorNotified, timedOut, stallReason }
  })

  return loop.pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (!approvalTraceActive) {
          return
        }
        approvalTraceLogger.info('stream-finished', {
          runId: runContext.runId,
          conversationId,
          aborted,
          timedOut,
          stallReason,
          runErrorNotified,
        })
      }),
    ),
  )
}
