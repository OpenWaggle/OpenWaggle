import { ConversationId, SupportedModelId } from '@shared/types/brand'
import type { AgentStreamChunk } from '@shared/types/stream'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRunContext } from '../runtime-types'
import { StreamPartCollector } from '../stream-part-collector'
import { processAgentStream } from '../stream-processor'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunContext(): AgentRunContext {
  return {
    runId: 'test-run',
    conversation: {
      id: ConversationId('conv-1'),
      title: 'Test',
      messages: [],
      projectPath: '/tmp',
      createdAt: 0,
      updatedAt: 0,
    },
    model: SupportedModelId('test-model'),
    settings: { executionMode: 'autonomous' },
    signal: new AbortController().signal,
    projectPath: '/tmp',
    hasProject: true,
    provider: { id: 'test' },
    providerConfig: { apiKey: 'k' },
  } as unknown as AgentRunContext
}

async function* chunksFrom(items: AgentStreamChunk[]): AsyncIterable<AgentStreamChunk> {
  for (const item of items) {
    yield item
  }
}

// ---------------------------------------------------------------------------
// processAgentStream
// ---------------------------------------------------------------------------

describe('processAgentStream', () => {
  it('forwards text chunks to collector and onChunk', async () => {
    const chunks: AgentStreamChunk[] = [
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'Hello ' } as AgentStreamChunk,
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'world' } as AgentStreamChunk,
      { type: 'RUN_FINISHED' } as AgentStreamChunk,
    ]

    const collector = new StreamPartCollector()
    const received: AgentStreamChunk[] = []

    const result = await processAgentStream({
      stream: chunksFrom(chunks),
      collector,
      onChunk: (c) => received.push(c),
      signal: new AbortController().signal,
      hooks: [],
      runContext: makeRunContext(),
    })

    expect(result.aborted).toBe(false)
    expect(result.runErrorNotified).toBe(false)
    expect(received).toHaveLength(3)

    const parts = collector.finalizeParts()
    expect(parts).toEqual([{ type: 'text', text: 'Hello world' }])
  })

  it('detects abort signal and stops processing', async () => {
    const controller = new AbortController()

    async function* abortingStream(): AsyncIterable<AgentStreamChunk> {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'Hi' } as AgentStreamChunk
      controller.abort()
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: ' there' } as AgentStreamChunk
    }

    const collector = new StreamPartCollector()
    const received: AgentStreamChunk[] = []

    const result = await processAgentStream({
      stream: abortingStream(),
      collector,
      onChunk: (c) => received.push(c),
      signal: controller.signal,
      hooks: [],
      runContext: makeRunContext(),
    })

    expect(result.aborted).toBe(true)
    // First chunk processed, second chunk triggers abort check
    expect(received.length).toBeGreaterThanOrEqual(1)
  })

  it('captures RUN_ERROR as providerError when no tools are pending', async () => {
    const chunks: AgentStreamChunk[] = [
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'partial' } as AgentStreamChunk,
      {
        type: 'RUN_ERROR',
        error: { message: '429 Rate limit exceeded', code: '429' },
      } as AgentStreamChunk,
    ]

    const collector = new StreamPartCollector()
    const received: AgentStreamChunk[] = []

    const result = await processAgentStream({
      stream: chunksFrom(chunks),
      collector,
      onChunk: (c) => received.push(c),
      signal: new AbortController().signal,
      hooks: [],
      runContext: makeRunContext(),
    })

    expect(result.providerError).toEqual({
      message: '429 Rate limit exceeded',
      code: '429',
    })
    expect(result.runErrorNotified).toBe(false)
    // RUN_ERROR chunk should NOT be forwarded to renderer
    expect(received.some((c) => c.type === 'RUN_ERROR')).toBe(false)
    // Error text should NOT be added to collector
    const parts = collector.finalizeParts()
    expect(parts.some((p) => p.type === 'text' && p.text.includes('Error'))).toBe(false)
  })

  it('captures non-retryable RUN_ERROR as providerError too (classification is caller responsibility)', async () => {
    const chunks: AgentStreamChunk[] = [
      {
        type: 'RUN_ERROR',
        error: { message: '401 Unauthorized: Invalid API key' },
      } as AgentStreamChunk,
    ]

    const collector = new StreamPartCollector()

    const result = await processAgentStream({
      stream: chunksFrom(chunks),
      collector,
      onChunk: () => {},
      signal: new AbortController().signal,
      hooks: [],
      runContext: makeRunContext(),
    })

    expect(result.providerError).toEqual({
      message: '401 Unauthorized: Invalid API key',
      code: undefined,
    })
    expect(result.runErrorNotified).toBe(false)
  })

  it('forwards RUN_ERROR normally when tools are awaiting results', async () => {
    const chunks: AgentStreamChunk[] = [
      {
        type: 'TOOL_CALL_START',
        toolCallId: 'tc-1',
        toolName: 'readFile',
      } as AgentStreamChunk,
      {
        type: 'TOOL_CALL_END',
        toolCallId: 'tc-1',
        toolName: 'readFile',
        result: undefined,
      } as AgentStreamChunk,
      {
        type: 'RUN_ERROR',
        error: { message: '429 Rate limit exceeded', code: '429' },
      } as AgentStreamChunk,
    ]

    const collector = new StreamPartCollector()

    const result = await processAgentStream({
      stream: chunksFrom(chunks),
      collector,
      onChunk: () => {},
      signal: new AbortController().signal,
      hooks: [],
      runContext: makeRunContext(),
    })

    // Should NOT be intercepted — tools are awaiting results
    expect(result.providerError).toBeUndefined()
    expect(result.runErrorNotified).toBe(true)
  })

  it('notifies lifecycle hooks on tool call events', async () => {
    const chunks: AgentStreamChunk[] = [
      {
        type: 'TOOL_CALL_START',
        toolCallId: 'tc-1',
        toolName: 'readFile',
      } as AgentStreamChunk,
      {
        type: 'TOOL_CALL_ARGS',
        toolCallId: 'tc-1',
        delta: '{"path":"/a.ts"}',
      } as AgentStreamChunk,
      {
        type: 'TOOL_CALL_END',
        toolCallId: 'tc-1',
        toolName: 'readFile',
        result: 'file contents',
      } as AgentStreamChunk,
      { type: 'RUN_FINISHED' } as AgentStreamChunk,
    ]

    const onStreamChunk = vi.fn()
    const onToolCallStart = vi.fn()
    const onToolCallEnd = vi.fn()

    const hook = {
      id: 'test-hook',
      onStreamChunk,
      onToolCallStart,
      onToolCallEnd,
    }

    const collector = new StreamPartCollector()

    await processAgentStream({
      stream: chunksFrom(chunks),
      collector,
      onChunk: () => {},
      signal: new AbortController().signal,
      hooks: [hook],
      runContext: makeRunContext(),
    })

    expect(onStreamChunk).toHaveBeenCalledTimes(4)
    expect(onToolCallStart).toHaveBeenCalledTimes(1)
    expect(onToolCallEnd).toHaveBeenCalledTimes(1)

    const stats = collector.getStats()
    expect(stats.toolCalls).toBe(1)
    expect(stats.toolErrors).toBe(0)
  })
})
