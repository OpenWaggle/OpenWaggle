import { STREAM_TIMEOUT } from '@shared/constants/timeouts'
import type { AgentStreamChunk } from '@shared/types/stream'
import { isUserBlockingToolName } from '@shared/types/tool-blocking'
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
export const STREAM_STALL_TIMEOUT_MS = STREAM_TIMEOUT.STALL_MS
export const INCOMPLETE_TOOL_CALL_STALL_TIMEOUT_MS = STREAM_TIMEOUT.INCOMPLETE_TOOL_CALL_MS

export type StreamStallReason = 'stream-stall' | 'incomplete-tool-args' | 'awaiting-tool-result'

/**
 * Returns true when a chunk represents a tool call that has finished
 * receiving arguments but has not yet executed — AND the tool is one
 * that blocks for user input (proposePlan / askUser). This is the
 * last synchronous opportunity to checkpoint conversation state before
 * the stream blocks on the tool's user-response promise.
 */
export function isUserBlockingToolCallEnd(chunk: AgentStreamChunk): boolean {
  return (
    chunk.type === 'TOOL_CALL_END' &&
    chunk.result === undefined &&
    isUserBlockingToolName(chunk.toolName)
  )
}

export interface ProcessAgentStreamParams {
  readonly stream: AsyncIterable<AgentStreamChunk>
  readonly collector: StreamPartCollector
  readonly onChunk: (chunk: AgentStreamChunk) => void
  readonly signal: AbortSignal
  readonly hooks: readonly AgentLifecycleHook[]
  readonly runContext: AgentRunContext
  readonly approvalTraceEnabled?: boolean
  /** Override stall timeout for testing. Defaults to STREAM_STALL_TIMEOUT_MS. */
  readonly stallTimeoutMs?: number
  /**
   * Called when a user-blocking tool (proposePlan / askUser) is about to
   * block for user input. The callback must persist the current conversation
   * state so that an app crash during the wait does not lose messages.
   */
  readonly onCheckpointNeeded?: () => Promise<void>
}

export interface ProviderErrorInfo {
  readonly message: string
  readonly code?: string
}

export interface ProcessAgentStreamResult {
  readonly aborted: boolean
  readonly runErrorNotified: boolean
  readonly timedOut: boolean
  readonly stallReason: StreamStallReason | null
  /**
   * Set when a RUN_ERROR chunk arrived and no tools were mid-execution.
   * The caller decides whether the error is retryable.
   */
  readonly providerError?: ProviderErrorInfo
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
  | { readonly kind: 'chunk'; readonly iterResult: IteratorResult<AgentStreamChunk> }
  | { readonly kind: 'stall' }

interface ForwardChunkParams {
  readonly collector: StreamPartCollector
  readonly onChunk: (chunk: AgentStreamChunk) => void
  readonly hooks: readonly AgentLifecycleHook[]
  readonly runContext: AgentRunContext
}

async function forwardChunk(params: ForwardChunkParams, chunk: AgentStreamChunk): Promise<boolean> {
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
  chunk: AgentStreamChunk,
): Effect.Effect<boolean, unknown> {
  return Effect.tryPromise(() => forwardChunk(params, chunk))
}

function isApprovalTraceChunk(chunk: AgentStreamChunk): boolean {
  if (chunk.type === 'TOOL_CALL_END') {
    return chunk.result === undefined
  }

  if (chunk.type === 'CUSTOM') {
    return chunk.name === 'approval-requested'
  }

  return chunk.type === 'RUN_FINISHED' || chunk.type === 'RUN_ERROR'
}

function waitForNextChunkOrAbort(
  iterator: AsyncIterator<AgentStreamChunk>,
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
  iterator: AsyncIterator<AgentStreamChunk>,
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
  let providerError: ProviderErrorInfo | undefined
  let approvalTraceActive = runtimeApprovalTraceEnabled && (params.approvalTraceEnabled ?? false)
  const iterator = stream[Symbol.asyncIterator]()

  const trackApprovalTraceState = (chunk: AgentStreamChunk): void => {
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

      // Intercept provider errors before they reach the collector.
      // When no tools are mid-execution, capture the error info and break
      // so the caller can decide whether to retry or surface the error.
      if (chunk.type === 'RUN_ERROR' && !collector.hasUnresolvedToolResults()) {
        providerError = {
          message: chunk.error.message,
          code: chunk.error.code,
        }
        break
      }

      const notifiedRunError = yield* forwardChunkEffect(forwardChunkParams, chunk)
      if (notifiedRunError) {
        runErrorNotified = true
      }

      // Checkpoint conversation state before the stream blocks on a
      // user-input tool (proposePlan / askUser). This is the last
      // opportunity to persist before the tool's promise blocks.
      if (isUserBlockingToolCallEnd(chunk) && params.onCheckpointNeeded) {
        const checkpoint = params.onCheckpointNeeded
        yield* Effect.promise(() => checkpoint())
      }
    }

    return { aborted, runErrorNotified, timedOut, stallReason, providerError }
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
