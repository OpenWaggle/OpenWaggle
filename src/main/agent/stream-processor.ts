import type { StreamChunk } from '@tanstack/ai'
import {
  notifyRunError,
  notifyStreamChunk,
  notifyToolCallEnd,
  notifyToolCallStart,
} from './lifecycle-hooks'
import type { AgentLifecycleHook, AgentRunContext } from './runtime-types'
import type { StreamPartCollector } from './stream-part-collector'

/**
 * Maximum time (ms) to wait for a new stream chunk before declaring the stream stalled.
 * When exceeded, `processAgentStream` returns with `timedOut: true` so the caller
 * can retry with a fresh stream.
 */
export const STREAM_STALL_TIMEOUT_MS = 120_000

export interface ProcessAgentStreamParams {
  readonly stream: AsyncIterable<StreamChunk>
  readonly collector: StreamPartCollector
  readonly onChunk: (chunk: StreamChunk) => void
  readonly signal: AbortSignal
  readonly hooks: readonly AgentLifecycleHook[]
  readonly runContext: AgentRunContext
  /** Override stall timeout for testing. Defaults to STREAM_STALL_TIMEOUT_MS. */
  readonly stallTimeoutMs?: number
}

export interface ProcessAgentStreamResult {
  readonly aborted: boolean
  readonly runErrorNotified: boolean
  readonly timedOut: boolean
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
  const timeout = params.stallTimeoutMs ?? STREAM_STALL_TIMEOUT_MS
  let aborted = false
  let runErrorNotified = false
  let timedOut = false

  const iterator = stream[Symbol.asyncIterator]()
  let stallTimer: ReturnType<typeof setTimeout> | null = null

  try {
    while (true) {
      if (signal.aborted) {
        aborted = true
        break
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
        break
      }

      if (result.iterResult.done) break

      const chunk = result.iterResult.value
      onChunk(chunk)
      notifyStreamChunk(hooks, runContext, chunk)

      const collected = collector.handleChunk(chunk)
      if (collected.toolCallStart) {
        notifyToolCallStart(hooks, runContext, collected.toolCallStart)
      }
      if (collected.toolCallEnd) {
        notifyToolCallEnd(hooks, runContext, collected.toolCallEnd)
      }
      if (collected.runError) {
        runErrorNotified = true
        await notifyRunError(hooks, runContext, collected.runError)
      }
    }
  } finally {
    if (stallTimer !== null) {
      clearTimeout(stallTimer)
    }
  }

  return { aborted, runErrorNotified, timedOut }
}
