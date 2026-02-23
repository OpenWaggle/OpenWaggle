import type { ConversationId } from '@shared/types/brand'
import { ConversationId as toConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { ModelMessage, StreamChunk } from '@tanstack/ai'
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

    const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
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
      {
        text: 'list files recursively',
        qualityPreset: 'medium',
        attachments: [],
      },
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

  it('does not cancel the main-process run on adapter abort', async () => {
    apiMock.sendMessage.mockResolvedValueOnce(undefined)

    const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
    const userMessage = {
      id: 'msg-user',
      role: 'user',
      parts: [{ type: 'text', content: 'keep running in background' }],
      createdAt: new Date(),
    } as UIMessage

    const abortController = new AbortController()
    const stream = connection.connect([userMessage], undefined, abortController.signal)
    const iterator = stream[Symbol.asyncIterator]()
    const nextPromise = iterator.next()
    abortController.abort()
    const result = await nextPromise

    expect(result.done).toBe(true)
    expect(apiMock.cancelAgent).not.toHaveBeenCalled()
  })

  it('exits cleanly when sendMessage resolves without a terminal chunk (approval-pending)', async () => {
    // Simulates TanStack pausing for tool approval: the main process run completes
    // (sendMessage resolves) but no RUN_FINISHED(stop) chunk is emitted.
    // The .then() handler should mark the stream as done.
    apiMock.sendMessage.mockImplementationOnce(async () => {
      emitStreamChunk(conversationId, {
        type: 'TOOL_CALL_START',
        timestamp: 1,
        toolCallId: 'tool-approval',
        toolName: 'writeFile',
      } as StreamChunk)
      // No terminal chunk emitted — run paused for approval
    })

    const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
    const userMessage = {
      id: 'msg-user',
      role: 'user',
      parts: [{ type: 'text', content: 'create a file' }],
      createdAt: new Date(),
    } as UIMessage

    const stream = connection.connect([userMessage], undefined, undefined)
    const chunks: StreamChunk[] = []

    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.type).toBe('TOOL_CALL_START')
  })

  it('uses provided pending payload for multimodal sends', async () => {
    apiMock.sendMessage.mockImplementationOnce(async () => {
      emitStreamChunk(conversationId, {
        type: 'RUN_FINISHED',
        timestamp: 10,
        runId: 'run-10',
        finishReason: 'stop',
      } as StreamChunk)
    })

    const payload = {
      text: 'Summarize attached files',
      qualityPreset: 'high' as const,
      attachments: [
        {
          id: 'a1',
          kind: 'text' as const,
          name: 'notes.txt',
          path: '/tmp/repo/notes.txt',
          mimeType: 'text/plain',
          sizeBytes: 12,
          extractedText: 'hello',
          source: null,
        },
      ],
    }

    const connection = createIpcConnectionAdapter(conversationId, model, () => payload, 'medium')
    const userMessage = {
      id: 'msg-user',
      role: 'user',
      parts: [{ type: 'text', content: payload.text }],
      createdAt: new Date(),
    } as UIMessage

    const stream = connection.connect([userMessage], undefined, undefined)
    for await (const _chunk of stream) {
      // consume
    }

    expect(apiMock.sendMessage).toHaveBeenCalledWith(conversationId, payload, model)
  })

  it('sends continuation messages when no pending payload exists and last message is not user', async () => {
    apiMock.sendMessage.mockImplementationOnce(async () => {
      emitStreamChunk(conversationId, {
        type: 'RUN_FINISHED',
        timestamp: 20,
        runId: 'run-20',
        finishReason: 'stop',
      } as StreamChunk)
    })

    const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
    const conversationMessages = [
      {
        id: 'msg-user',
        role: 'user',
        parts: [{ type: 'text', content: 'write a file' }],
        createdAt: new Date(),
      },
      {
        id: 'msg-assistant',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-1',
            name: 'writeFile',
            arguments: '{}',
            state: 'approval-responded',
            approval: {
              id: 'approval_tool-1',
              needsApproval: true,
              approved: true,
            },
          },
        ],
        createdAt: new Date(),
      },
    ] as UIMessage[]

    const stream = connection.connect(conversationMessages, undefined, undefined)
    for await (const _chunk of stream) {
      // consume
    }

    expect(apiMock.sendMessage).toHaveBeenCalledTimes(1)
    expect(apiMock.sendMessage).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({
        text: '',
        qualityPreset: 'medium',
        attachments: [],
        continuationMessages: expect.any(Array),
      }),
      model,
    )
  })

  it('dedupes duplicate continuation tool-call IDs before sending', async () => {
    apiMock.sendMessage.mockImplementationOnce(async () => {
      emitStreamChunk(conversationId, {
        type: 'RUN_FINISHED',
        timestamp: 21,
        runId: 'run-21',
        finishReason: 'stop',
      } as StreamChunk)
    })

    const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
    const conversationMessages = [
      {
        id: 'msg-user',
        role: 'user',
        parts: [{ type: 'text', content: 'create a summary file' }],
        createdAt: new Date(),
      },
      {
        id: 'msg-assistant',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-dup',
            name: 'writeFile',
            arguments: '{"path":"SUMMARY.md"}',
            state: 'input-complete',
          },
          {
            type: 'tool-call',
            id: 'tool-dup',
            name: 'writeFile',
            arguments: '{"path":"SUMMARY.md"}',
            state: 'approval-responded',
            approval: {
              id: 'approval_tool-dup',
              needsApproval: true,
              approved: true,
            },
          },
        ],
        createdAt: new Date(),
      },
    ] as UIMessage[]

    const stream = connection.connect(conversationMessages, undefined, undefined)
    for await (const _chunk of stream) {
      // consume
    }

    const sentPayload = apiMock.sendMessage.mock.calls[0]?.[1] as {
      continuationMessages?: ModelMessage[]
    }
    const continuationMessages = sentPayload.continuationMessages ?? []

    const assistantToolCalls = continuationMessages
      .filter(
        (
          message,
        ): message is ModelMessage & { toolCalls: NonNullable<ModelMessage['toolCalls']> } =>
          message.role === 'assistant' && Array.isArray(message.toolCalls),
      )
      .flatMap((message) => message.toolCalls.map((toolCall) => toolCall.id))

    expect(assistantToolCalls).toContain('tool-dup')
    expect(new Set(assistantToolCalls).size).toBe(assistantToolCalls.length)
  })
})
