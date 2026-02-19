import type { ConversationId } from '@shared/types/brand'
import { ConversationId as toConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { StreamChunk } from '@tanstack/ai'
import type { UIMessage } from '@tanstack/ai-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { streamListeners, apiMock } = vi.hoisted(() => {
  const listeners = new Set<
    (payload: { conversationId: ConversationId; chunk: StreamChunk }) => void
  >()

  return {
    streamListeners: listeners,
    apiMock: {
      onStreamChunk: vi.fn(
        (callback: (payload: { conversationId: ConversationId; chunk: StreamChunk }) => void) => {
          listeners.add(callback)
          return () => listeners.delete(callback)
        },
      ),
      sendMessage: vi.fn(),
      cancelAgent: vi.fn(),
    },
  }
})

vi.mock('@/lib/ipc', () => ({
  api: apiMock,
}))

import { createIpcConnectionAdapter } from './ipc-connection-adapter'

function emitStreamChunk(conversationId: ConversationId, chunk: StreamChunk): void {
  for (const callback of streamListeners) {
    callback({ conversationId, chunk })
  }
}

describe('createIpcConnectionAdapter', () => {
  const conversationId = toConversationId('conv-stream')
  const model = 'gpt-5-mini' as SupportedModelId

  beforeEach(() => {
    vi.clearAllMocks()
    streamListeners.clear()
  })

  it('does not terminate on intermediate RUN_FINISHED with tool_calls', async () => {
    apiMock.sendMessage.mockImplementationOnce(async () => {
      emitStreamChunk(conversationId, {
        type: 'TOOL_CALL_START',
        timestamp: 1,
        toolCallId: 'tool-1',
        toolName: 'listFiles',
      } as StreamChunk)
      emitStreamChunk(conversationId, {
        type: 'TOOL_CALL_ARGS',
        timestamp: 2,
        toolCallId: 'tool-1',
        delta: '{"path":".","recursive":true}',
      } as StreamChunk)
      emitStreamChunk(conversationId, {
        type: 'TOOL_CALL_END',
        timestamp: 3,
        toolCallId: 'tool-1',
        toolName: 'listFiles',
      } as StreamChunk)
      emitStreamChunk(conversationId, {
        type: 'RUN_FINISHED',
        timestamp: 4,
        runId: 'run-1',
        finishReason: 'tool_calls',
      } as StreamChunk)
      emitStreamChunk(conversationId, {
        type: 'TOOL_CALL_END',
        timestamp: 5,
        toolCallId: 'tool-1',
        toolName: 'listFiles',
        result: '{"kind":"text","text":"src/\\npackage.json"}',
      } as StreamChunk)
      emitStreamChunk(conversationId, {
        type: 'RUN_FINISHED',
        timestamp: 6,
        runId: 'run-1',
        finishReason: 'stop',
      } as StreamChunk)
    })

    const connection = createIpcConnectionAdapter(conversationId, model)
    const userMessage = {
      id: 'msg-user',
      role: 'user',
      parts: [{ type: 'text', content: 'list files recursively' }],
      createdAt: new Date(),
    } as UIMessage

    const stream = connection.connect([userMessage], undefined, undefined)
    const chunks: StreamChunk[] = []

    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(apiMock.sendMessage).toHaveBeenCalledWith(
      conversationId,
      'list files recursively',
      model,
    )
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      'RUN_FINISHED',
      'TOOL_CALL_END',
      'RUN_FINISHED',
    ])
  })
})
