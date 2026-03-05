import type { ConversationId } from '@shared/types/brand'
import { SupportedModelId, ConversationId as toConversationId } from '@shared/types/brand'
import type { StreamChunk } from '@tanstack/ai'
import type { UIMessage } from '@tanstack/ai-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { streamListeners, runCompletedListeners, apiMock } = vi.hoisted(() => {
  const listeners = new Set<
    (payload: { conversationId: ConversationId; chunk: StreamChunk }) => void
  >()
  const runCompletedListeners = new Set<(payload: { conversationId: ConversationId }) => void>()

  return {
    streamListeners: listeners,
    apiMock: {
      onStreamChunk: vi.fn(
        (callback: (payload: { conversationId: ConversationId; chunk: StreamChunk }) => void) => {
          listeners.add(callback)
          return () => listeners.delete(callback)
        },
      ),
      onRunCompleted: vi.fn((callback: (payload: { conversationId: ConversationId }) => void) => {
        runCompletedListeners.add(callback)
        return () => runCompletedListeners.delete(callback)
      }),
      sendMessage: vi.fn(),
      cancelAgent: vi.fn(),
    },
    runCompletedListeners,
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

function emitRunCompleted(conversationId: ConversationId): void {
  for (const callback of runCompletedListeners) {
    callback({ conversationId })
  }
}

describe('createIpcConnectionAdapter', () => {
  const conversationId = toConversationId('conv-stream')
  const model = SupportedModelId('gpt-5-mini')

  beforeEach(() => {
    vi.clearAllMocks()
    streamListeners.clear()
    runCompletedListeners.clear()
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

  it('exits cleanly when run-completed arrives without a terminal chunk (approval-pending)', async () => {
    // Simulates TanStack pausing for tool approval: no terminal chunk is emitted,
    // but the main process still emits run-completed.
    apiMock.sendMessage.mockImplementationOnce(async () => {
      emitStreamChunk(conversationId, {
        type: 'TOOL_CALL_START',
        timestamp: 1,
        toolCallId: 'tool-approval',
        toolName: 'writeFile',
      } as StreamChunk)
      emitRunCompleted(conversationId)
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

  it('keeps stream open briefly when run-completed arrives before final terminal chunk', async () => {
    apiMock.sendMessage.mockImplementationOnce(async () => {
      emitRunCompleted(conversationId)
      emitStreamChunk(conversationId, {
        type: 'RUN_FINISHED',
        timestamp: 2,
        runId: 'run-late-terminal',
        finishReason: 'stop',
      } as StreamChunk)
    })

    const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
    const userMessage = {
      id: 'msg-user',
      role: 'user',
      parts: [{ type: 'text', content: 'finish cleanly' }],
      createdAt: new Date(),
    } as UIMessage

    const stream = connection.connect([userMessage], undefined, undefined)
    const chunks: StreamChunk[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.type).toBe('RUN_FINISHED')
  })

  it('captures delayed terminal chunk that arrives shortly after run-completed', async () => {
    vi.useFakeTimers()
    try {
      apiMock.sendMessage.mockImplementationOnce(async () => {
        emitRunCompleted(conversationId)
        setTimeout(() => {
          emitStreamChunk(conversationId, {
            type: 'RUN_FINISHED',
            timestamp: 3,
            runId: 'run-delayed-terminal',
            finishReason: 'stop',
          } as StreamChunk)
        }, 200)
      })

      const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
      const userMessage = {
        id: 'msg-user',
        role: 'user',
        parts: [{ type: 'text', content: 'wait for delayed finish' }],
        createdAt: new Date(),
      } as UIMessage

      const stream = connection.connect([userMessage], undefined, undefined)
      const consumePromise = (async () => {
        const chunks: StreamChunk[] = []
        for await (const chunk of stream) {
          chunks.push(chunk)
        }
        return chunks
      })()

      await vi.advanceTimersByTimeAsync(250)
      const chunks = await consumePromise

      expect(chunks.map((chunk) => chunk.type)).toEqual(['RUN_FINISHED'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('captures delayed text + terminal chunks that arrive after run-completed', async () => {
    vi.useFakeTimers()
    try {
      apiMock.sendMessage.mockImplementationOnce(async () => {
        emitRunCompleted(conversationId)
        setTimeout(() => {
          emitStreamChunk(conversationId, {
            type: 'TEXT_MESSAGE_CONTENT',
            timestamp: 4,
            text: 'done',
            delta: 'done',
          } as StreamChunk)
        }, 200)
        setTimeout(() => {
          emitStreamChunk(conversationId, {
            type: 'RUN_FINISHED',
            timestamp: 5,
            runId: 'run-delayed-final-text',
            finishReason: 'stop',
          } as StreamChunk)
        }, 220)
      })

      const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
      const userMessage = {
        id: 'msg-user',
        role: 'user',
        parts: [{ type: 'text', content: 'finish with text' }],
        createdAt: new Date(),
      } as UIMessage

      const stream = connection.connect([userMessage], undefined, undefined)
      const consumePromise = (async () => {
        const chunks: StreamChunk[] = []
        for await (const chunk of stream) {
          chunks.push(chunk)
        }
        return chunks
      })()

      await vi.advanceTimersByTimeAsync(260)
      const chunks = await consumePromise

      expect(chunks.map((chunk) => chunk.type)).toEqual(['TEXT_MESSAGE_CONTENT', 'RUN_FINISHED'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('captures delayed approval-requested custom chunk after tool-call-end with pending result', async () => {
    vi.useFakeTimers()
    try {
      apiMock.sendMessage.mockImplementationOnce(async () => {
        emitStreamChunk(conversationId, {
          type: 'TOOL_CALL_START',
          timestamp: 6,
          toolCallId: 'tool-approval-late',
          toolName: 'runCommand',
        } as StreamChunk)
        emitStreamChunk(conversationId, {
          type: 'TOOL_CALL_END',
          timestamp: 7,
          toolCallId: 'tool-approval-late',
          toolName: 'runCommand',
        } as StreamChunk)
        emitRunCompleted(conversationId)
        setTimeout(() => {
          emitStreamChunk(conversationId, {
            type: 'CUSTOM',
            timestamp: 8,
            name: 'approval-requested',
            value: {
              toolCallId: 'tool-approval-late',
              toolName: 'runCommand',
              input: { command: 'echo "pre-approved command"' },
              approval: { id: 'approval_tool-approval-late' },
            },
          } as StreamChunk)
        }, 800)
      })

      const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
      const userMessage = {
        id: 'msg-user',
        role: 'user',
        parts: [{ type: 'text', content: 'needs approval metadata' }],
        createdAt: new Date(),
      } as UIMessage

      const stream = connection.connect([userMessage], undefined, undefined)
      const consumePromise = (async () => {
        const chunks: StreamChunk[] = []
        for await (const chunk of stream) {
          chunks.push(chunk)
        }
        return chunks
      })()

      await vi.advanceTimersByTimeAsync(3_000)
      const chunks = await consumePromise

      expect(chunks.map((chunk) => chunk.type)).toEqual([
        'TOOL_CALL_START',
        'TOOL_CALL_END',
        'CUSTOM',
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('defers stream close when RUN_FINISHED arrives with pending approval tool results', async () => {
    vi.useFakeTimers()
    try {
      apiMock.sendMessage.mockImplementationOnce(async () => {
        emitStreamChunk(conversationId, {
          type: 'TOOL_CALL_START',
          timestamp: 1,
          toolCallId: 'tool-approval-pending',
          toolName: 'runCommand',
        } as StreamChunk)
        emitStreamChunk(conversationId, {
          type: 'TOOL_CALL_ARGS',
          timestamp: 2,
          toolCallId: 'tool-approval-pending',
          delta: '{"command":"echo hello"}',
        } as StreamChunk)
        // TOOL_CALL_END without result → approval pending
        emitStreamChunk(conversationId, {
          type: 'TOOL_CALL_END',
          timestamp: 3,
          toolCallId: 'tool-approval-pending',
          toolName: 'runCommand',
        } as StreamChunk)
        // RUN_FINISHED with 'stop' should NOT close the stream immediately
        emitStreamChunk(conversationId, {
          type: 'RUN_FINISHED',
          timestamp: 4,
          runId: 'run-approval',
          finishReason: 'stop',
        } as StreamChunk)
        // CUSTOM approval metadata arrives after RUN_FINISHED
        setTimeout(() => {
          emitStreamChunk(conversationId, {
            type: 'CUSTOM',
            timestamp: 5,
            name: 'approval-requested',
            value: {
              toolCallId: 'tool-approval-pending',
              toolName: 'runCommand',
              input: { command: 'echo hello' },
              approval: { id: 'approval_tool-approval-pending', needsApproval: true },
            },
          } as StreamChunk)
        }, 500)
      })

      const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
      const userMessage = {
        id: 'msg-user',
        role: 'user',
        parts: [{ type: 'text', content: 'run echo hello' }],
        createdAt: new Date(),
      } as UIMessage

      const stream = connection.connect([userMessage], undefined, undefined)
      const consumePromise = (async () => {
        const chunks: StreamChunk[] = []
        for await (const chunk of stream) {
          chunks.push(chunk)
        }
        return chunks
      })()

      await vi.advanceTimersByTimeAsync(3_000)
      const chunks = await consumePromise

      // The CUSTOM chunk must be captured — not lost due to early stream close
      expect(chunks.map((chunk) => chunk.type)).toEqual([
        'TOOL_CALL_START',
        'TOOL_CALL_ARGS',
        'TOOL_CALL_END',
        'RUN_FINISHED',
        'CUSTOM',
      ])
    } finally {
      vi.useRealTimers()
    }
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

  it('preserves approval metadata in continuation message snapshots', async () => {
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

    const sentPayload = apiMock.sendMessage.mock.calls[0]?.[1]
    expect(sentPayload).toMatchObject({
      continuationMessages: expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: 'tool-call',
              id: 'tool-dup',
              state: 'approval-responded',
              approval: expect.objectContaining({
                id: 'approval_tool-dup',
                approved: true,
              }),
            }),
          ]),
        }),
      ]),
    })
  })

  it('emits RUN_ERROR instead of sending empty continuation when approval context is missing', async () => {
    const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
    const messagesWithoutApproval = [
      {
        id: 'msg-user',
        role: 'user',
        parts: [{ type: 'text', content: 'initial prompt' }],
        createdAt: new Date(),
      },
      {
        id: 'msg-assistant',
        role: 'assistant',
        parts: [{ type: 'text', content: 'Done.' }],
        createdAt: new Date(),
      },
    ] as UIMessage[]

    const stream = connection.connect(messagesWithoutApproval, undefined, undefined)
    const chunks: StreamChunk[] = []

    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(apiMock.sendMessage).not.toHaveBeenCalled()
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.type).toBe('RUN_ERROR')
    if (chunks[0]?.type === 'RUN_ERROR') {
      expect(chunks[0].error.message).toContain('no pending payload or approval context')
    }
  })
})
