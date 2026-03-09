import type { StreamChunk } from '@tanstack/ai'
import { describe, expect, it, vi } from 'vitest'
import type { AgentLifecycleHook, AgentRunContext } from '../runtime-types'
import { StreamPartCollector } from '../stream-part-collector'
import { processAgentStream, STREAM_STALL_TIMEOUT_MS } from '../stream-processor'

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

function makeTextChunk(text: string): StreamChunk {
  return {
    type: 'TEXT_MESSAGE_CONTENT',
    timestamp: Date.now(),
    messageId: 'msg-1',
    delta: text,
  } as StreamChunk
}

function makeFinishedChunk(): StreamChunk {
  return {
    type: 'RUN_FINISHED',
    timestamp: Date.now(),
    runId: 'run-1',
    finishReason: 'stop',
  } as StreamChunk
}

async function* yieldChunks(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) {
    yield chunk
  }
}

function baseParams(
  stream: AsyncIterable<StreamChunk>,
  overrides: Partial<{
    signal: AbortSignal
    stallTimeoutMs: number
  }> = {},
) {
  return {
    stream,
    collector: new StreamPartCollector(),
    onChunk: vi.fn(),
    signal: overrides.signal ?? new AbortController().signal,
    hooks: [] as readonly AgentLifecycleHook[],
    runContext: {} as AgentRunContext,
    stallTimeoutMs: overrides.stallTimeoutMs,
  }
}

describe('processAgentStream', () => {
  it('exports STREAM_STALL_TIMEOUT_MS as 120 seconds', () => {
    const TWO_MINUTES_MS = 120_000
    expect(STREAM_STALL_TIMEOUT_MS).toBe(TWO_MINUTES_MS)
  })

  it('processes all chunks and returns timedOut: false on normal completion', async () => {
    const chunks = [makeTextChunk('hello'), makeTextChunk(' world'), makeFinishedChunk()]
    const stream = yieldChunks(chunks)
    const params = baseParams(stream)

    const result = await processAgentStream(params)

    expect(result.timedOut).toBe(false)
    expect(result.stallReason).toBeNull()
    expect(result.aborted).toBe(false)
    expect(result.runErrorNotified).toBe(false)
    expect(params.onChunk).toHaveBeenCalledTimes(chunks.length)
  })

  it('returns timedOut: true when stream stalls beyond the timeout', async () => {
    // Create an async iterable that yields one chunk then stalls forever
    async function* stallAfterOne(): AsyncIterable<StreamChunk> {
      yield makeTextChunk('start')
      // Never yields again — simulates a stalled stream
      await new Promise(() => {})
    }

    const FAST_TIMEOUT_MS = 50
    const params = baseParams(stallAfterOne(), { stallTimeoutMs: FAST_TIMEOUT_MS })

    const result = await processAgentStream(params)

    expect(result.timedOut).toBe(true)
    expect(result.stallReason).toBe('stream-stall')
    expect(result.aborted).toBe(false)
    expect(params.onChunk).toHaveBeenCalledTimes(1)
  })

  it('returns aborted: true when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const chunks = [makeTextChunk('hello')]
    const stream = yieldChunks(chunks)
    const params = baseParams(stream, { signal: controller.signal })

    const result = await processAgentStream(params)

    expect(result.aborted).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.stallReason).toBeNull()
    expect(params.onChunk).not.toHaveBeenCalled()
  })

  it('returns aborted: true when signal fires mid-stream', async () => {
    const controller = new AbortController()

    // Yield one chunk, then abort, then try another
    async function* abortMidStream(): AsyncIterable<StreamChunk> {
      yield makeTextChunk('before')
      controller.abort()
      yield makeTextChunk('after')
    }

    const params = baseParams(abortMidStream(), { signal: controller.signal })

    const result = await processAgentStream(params)

    expect(result.aborted).toBe(true)
    expect(result.stallReason).toBeNull()
    // Should have processed at least the first chunk
    expect(params.onChunk).toHaveBeenCalledWith(expect.objectContaining({ delta: 'before' }))
  })

  it('does not time out when chunks arrive within the timeout window', async () => {
    const FAST_TIMEOUT_MS = 200

    // Yield chunks with a small delay between them (well within timeout)
    async function* slowButNotStalled(): AsyncIterable<StreamChunk> {
      yield makeTextChunk('one')
      await new Promise((resolve) => setTimeout(resolve, 20))
      yield makeTextChunk('two')
      await new Promise((resolve) => setTimeout(resolve, 20))
      yield makeTextChunk('three')
    }

    const params = baseParams(slowButNotStalled(), { stallTimeoutMs: FAST_TIMEOUT_MS })

    const result = await processAgentStream(params)

    expect(result.timedOut).toBe(false)
    expect(result.stallReason).toBeNull()
    expect(params.onChunk).toHaveBeenCalledTimes(3)
  })

  it('flags incomplete tool calls as a non-retryable stall reason', async () => {
    async function* toolCallThenStall(): AsyncIterable<StreamChunk> {
      yield {
        type: 'TOOL_CALL_START',
        timestamp: Date.now(),
        toolCallId: 'tc-1',
        toolName: 'writeFile',
      } as StreamChunk
      await new Promise(() => {})
    }

    const FAST_TIMEOUT_MS = 30
    const params = baseParams(toolCallThenStall(), { stallTimeoutMs: FAST_TIMEOUT_MS })

    const result = await processAgentStream(params)

    expect(result.timedOut).toBe(true)
    expect(result.stallReason).toBe('incomplete-tool-call')
    expect(params.onChunk).toHaveBeenCalledTimes(1)
  })

  it('waits for approval response indefinitely until aborted', async () => {
    async function* endedWithoutResultThenStall(): AsyncIterable<StreamChunk> {
      yield {
        type: 'TOOL_CALL_START',
        timestamp: Date.now(),
        toolCallId: 'tc-2',
        toolName: 'writeFile',
      } as StreamChunk
      yield {
        type: 'TOOL_CALL_END',
        timestamp: Date.now(),
        toolCallId: 'tc-2',
        toolName: 'writeFile',
      } as StreamChunk
      await new Promise(() => {})
    }

    const FAST_ABORT_MS = 20
    const controller = new AbortController()
    setTimeout(() => controller.abort(), FAST_ABORT_MS)
    const params = baseParams(endedWithoutResultThenStall(), {
      signal: controller.signal,
      stallTimeoutMs: FAST_ABORT_MS,
    })

    const result = await processAgentStream(params)

    expect(result.aborted).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.stallReason).toBeNull()
  })

  it('removes abort listener after unresolved-tool wait receives a chunk', async () => {
    async function* unresolvedThenResumes(): AsyncIterable<StreamChunk> {
      yield {
        type: 'TOOL_CALL_START',
        timestamp: Date.now(),
        toolCallId: 'tc-cleanup',
        toolName: 'writeFile',
      } as StreamChunk
      yield {
        type: 'TOOL_CALL_END',
        timestamp: Date.now(),
        toolCallId: 'tc-cleanup',
        toolName: 'writeFile',
      } as StreamChunk
      yield makeTextChunk('approved-result')
      yield makeFinishedChunk()
    }

    const controller = new AbortController()
    const removeListenerSpy = vi.spyOn(controller.signal, 'removeEventListener')
    const params = baseParams(unresolvedThenResumes(), { signal: controller.signal })

    const result = await processAgentStream(params)

    expect(result.timedOut).toBe(false)
    expect(result.aborted).toBe(false)
    expect(removeListenerSpy).toHaveBeenCalled()
  })
})
