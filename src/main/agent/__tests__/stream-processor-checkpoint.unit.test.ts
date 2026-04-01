import { ConversationId, SupportedModelId } from '@shared/types/brand'
import type { AgentStreamChunk } from '@shared/types/stream'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRunContext } from '../runtime-types'
import { StreamPartCollector } from '../stream-part-collector'
import { isUserBlockingToolCallEnd, processAgentStream } from '../stream-processor'

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
// isUserBlockingToolCallEnd
// ---------------------------------------------------------------------------

describe('isUserBlockingToolCallEnd', () => {
  it('returns true for proposePlan TOOL_CALL_END without result', () => {
    const chunk = {
      type: 'TOOL_CALL_END',
      toolCallId: 'tc-1',
      toolName: 'proposePlan',
      result: undefined,
    } as AgentStreamChunk

    expect(isUserBlockingToolCallEnd(chunk)).toBe(true)
  })

  it('returns true for askUser TOOL_CALL_END without result', () => {
    const chunk = {
      type: 'TOOL_CALL_END',
      toolCallId: 'tc-2',
      toolName: 'askUser',
      result: undefined,
    } as AgentStreamChunk

    expect(isUserBlockingToolCallEnd(chunk)).toBe(true)
  })

  it('returns false for proposePlan TOOL_CALL_END with result', () => {
    const chunk = {
      type: 'TOOL_CALL_END',
      toolCallId: 'tc-3',
      toolName: 'proposePlan',
      result: '{"action":"approve"}',
    } as AgentStreamChunk

    expect(isUserBlockingToolCallEnd(chunk)).toBe(false)
  })

  it('returns false for non-blocking tool TOOL_CALL_END without result', () => {
    const chunk = {
      type: 'TOOL_CALL_END',
      toolCallId: 'tc-4',
      toolName: 'readFile',
      result: undefined,
    } as AgentStreamChunk

    expect(isUserBlockingToolCallEnd(chunk)).toBe(false)
  })

  it('returns false for non-TOOL_CALL_END chunks', () => {
    const chunk = {
      type: 'TEXT_MESSAGE_CONTENT',
      delta: 'hello',
    } as AgentStreamChunk

    expect(isUserBlockingToolCallEnd(chunk)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Checkpoint callback in processAgentStream
// ---------------------------------------------------------------------------

describe('processAgentStream checkpoint', () => {
  it('calls onCheckpointNeeded when a blocking tool TOOL_CALL_END arrives', async () => {
    const chunks: AgentStreamChunk[] = [
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'Planning...' } as AgentStreamChunk,
      {
        type: 'TOOL_CALL_START',
        toolCallId: 'tc-1',
        toolName: 'proposePlan',
      } as AgentStreamChunk,
      {
        type: 'TOOL_CALL_ARGS',
        toolCallId: 'tc-1',
        delta: '{"planText":"Do X then Y"}',
      } as AgentStreamChunk,
      {
        type: 'TOOL_CALL_END',
        toolCallId: 'tc-1',
        toolName: 'proposePlan',
        result: undefined,
      } as AgentStreamChunk,
      // After checkpoint, the tool would block — simulate stream ending
      { type: 'RUN_FINISHED' } as AgentStreamChunk,
    ]

    const onCheckpointNeeded = vi.fn().mockResolvedValue(undefined)

    await processAgentStream({
      stream: chunksFrom(chunks),
      collector: new StreamPartCollector(),
      onChunk: () => {},
      signal: new AbortController().signal,
      hooks: [],
      runContext: makeRunContext(),
      onCheckpointNeeded,
    })

    expect(onCheckpointNeeded).toHaveBeenCalledOnce()
  })

  it('does NOT call onCheckpointNeeded for non-blocking tools', async () => {
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
      { type: 'RUN_FINISHED' } as AgentStreamChunk,
    ]

    const onCheckpointNeeded = vi.fn().mockResolvedValue(undefined)

    await processAgentStream({
      stream: chunksFrom(chunks),
      collector: new StreamPartCollector(),
      onChunk: () => {},
      signal: new AbortController().signal,
      hooks: [],
      runContext: makeRunContext(),
      onCheckpointNeeded,
    })

    expect(onCheckpointNeeded).not.toHaveBeenCalled()
  })

  it('does NOT call onCheckpointNeeded when callback is not provided', async () => {
    const chunks: AgentStreamChunk[] = [
      {
        type: 'TOOL_CALL_START',
        toolCallId: 'tc-1',
        toolName: 'proposePlan',
      } as AgentStreamChunk,
      {
        type: 'TOOL_CALL_END',
        toolCallId: 'tc-1',
        toolName: 'proposePlan',
        result: undefined,
      } as AgentStreamChunk,
      { type: 'RUN_FINISHED' } as AgentStreamChunk,
    ]

    // Should not throw when onCheckpointNeeded is undefined
    const result = await processAgentStream({
      stream: chunksFrom(chunks),
      collector: new StreamPartCollector(),
      onChunk: () => {},
      signal: new AbortController().signal,
      hooks: [],
      runContext: makeRunContext(),
    })

    expect(result.aborted).toBe(false)
  })
})
