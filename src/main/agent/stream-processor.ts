import type { StreamChunk } from '@tanstack/ai'
import {
  notifyRunError,
  notifyStreamChunk,
  notifyToolCallEnd,
  notifyToolCallStart,
} from './lifecycle-hooks'
import type { AgentLifecycleHook, AgentRunContext } from './runtime-types'
import type { StreamPartCollector } from './stream-part-collector'

export interface ProcessAgentStreamParams {
  readonly stream: AsyncIterable<StreamChunk>
  readonly collector: StreamPartCollector
  readonly onChunk: (chunk: StreamChunk) => void
  readonly signal: AbortSignal
  readonly hooks: readonly AgentLifecycleHook[]
  readonly runContext: AgentRunContext
}

export interface ProcessAgentStreamResult {
  readonly aborted: boolean
  readonly runErrorNotified: boolean
}

/**
 * Iterate the agent stream, forwarding chunks and collecting tool call events.
 * Extracted from `runAgent()` for testability.
 */
export async function processAgentStream(
  params: ProcessAgentStreamParams,
): Promise<ProcessAgentStreamResult> {
  const { stream, collector, onChunk, signal, hooks, runContext } = params
  let aborted = false
  let runErrorNotified = false

  for await (const chunk of stream) {
    if (signal.aborted) {
      aborted = true
      break
    }

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

  return { aborted, runErrorNotified }
}
