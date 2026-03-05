/**
 * Additional unit tests for ipc-connection-adapter — covers branches
 * not exercised by the existing ipc-connection-adapter.unit.test.ts.
 */
import type { ConversationId } from '@shared/types/brand'
import { SupportedModelId, ConversationId as toConversationId } from '@shared/types/brand'
import type { StreamChunk } from '@tanstack/ai'
import type { UIMessage } from '@tanstack/ai-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── IPC Mock ───────────────────────────────────────────────
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
      sendWaggleMessage: vi.fn(),
      cancelAgent: vi.fn(),
    },
    runCompletedListeners,
  }
})

vi.mock('@/lib/ipc', () => ({
  api: apiMock,
}))

import {
  clearLastAgentErrorInfo,
  createIpcConnectionAdapter,
  getLastAgentErrorInfo,
  isTerminalChunk,
} from './ipc-connection-adapter'

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

describe('isTerminalChunk', () => {
  it('returns true for RUN_ERROR', () => {
    const chunk: StreamChunk = {
      type: 'RUN_ERROR',
      timestamp: 1,
      error: { message: 'boom' },
    }
    expect(isTerminalChunk(chunk)).toBe(true)
  })

  it('returns true for RUN_FINISHED with stop', () => {
    const chunk: StreamChunk = {
      type: 'RUN_FINISHED',
      timestamp: 1,
      runId: 'r1',
      finishReason: 'stop',
    }
    expect(isTerminalChunk(chunk)).toBe(true)
  })

  it('returns false for RUN_FINISHED with tool_calls', () => {
    const chunk: StreamChunk = {
      type: 'RUN_FINISHED',
      timestamp: 1,
      runId: 'r1',
      finishReason: 'tool_calls',
    }
    expect(isTerminalChunk(chunk)).toBe(false)
  })

  it('returns false for non-terminal chunk types', () => {
    const chunk: StreamChunk = {
      type: 'TEXT_MESSAGE_CONTENT',
      timestamp: 1,
      delta: 'hello',
    }
    expect(isTerminalChunk(chunk)).toBe(false)
  })

  it('returns false for TOOL_CALL_START', () => {
    const chunk: StreamChunk = {
      type: 'TOOL_CALL_START',
      timestamp: 1,
      toolCallId: 'tc1',
      toolName: 'readFile',
    }
    expect(isTerminalChunk(chunk)).toBe(false)
  })
})

describe('error info side-channel', () => {
  const convId = toConversationId('err-conv')

  beforeEach(() => {
    clearLastAgentErrorInfo(convId)
  })

  it('getLastAgentErrorInfo returns null when no error stored', () => {
    expect(getLastAgentErrorInfo(convId)).toBeNull()
  })

  it('clearLastAgentErrorInfo is safe to call when no error exists', () => {
    clearLastAgentErrorInfo(convId)
    expect(getLastAgentErrorInfo(convId)).toBeNull()
  })
})

describe('createIpcConnectionAdapter — additional branches', () => {
  const conversationId = toConversationId('conv-extra')
  const model = SupportedModelId('gpt-5-mini')

  beforeEach(() => {
    vi.clearAllMocks()
    streamListeners.clear()
    runCompletedListeners.clear()
    clearLastAgentErrorInfo(conversationId)
  })

  it('captures structured error info on RUN_ERROR with known error code', async () => {
    apiMock.sendMessage.mockImplementationOnce(async () => {
      emitStreamChunk(conversationId, {
        type: 'RUN_ERROR',
        timestamp: 1,
        error: { message: 'Invalid API key', code: 'api-key-invalid' },
      } as StreamChunk)
    })

    const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
    const userMessage = {
      id: 'msg-u',
      role: 'user',
      parts: [{ type: 'text', content: 'hello' }],
      createdAt: new Date(),
    } as UIMessage

    const stream = connection.connect([userMessage], undefined, undefined)
    for await (const _chunk of stream) {
      // consume
    }

    const errorInfo = getLastAgentErrorInfo(conversationId)
    expect(errorInfo).not.toBeNull()
    expect(errorInfo?.code).toBe('api-key-invalid')
  })

  it('classifies error info from message when RUN_ERROR has no code', async () => {
    apiMock.sendMessage.mockImplementationOnce(async () => {
      emitStreamChunk(conversationId, {
        type: 'RUN_ERROR',
        timestamp: 1,
        error: { message: 'rate limit exceeded 429' },
      } as StreamChunk)
    })

    const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
    const userMessage = {
      id: 'msg-u',
      role: 'user',
      parts: [{ type: 'text', content: 'test' }],
      createdAt: new Date(),
    } as UIMessage

    const stream = connection.connect([userMessage], undefined, undefined)
    for await (const _chunk of stream) {
      // consume
    }

    const errorInfo = getLastAgentErrorInfo(conversationId)
    expect(errorInfo).not.toBeNull()
    expect(errorInfo?.code).toBe('rate-limited')
  })

  it('clears stale error info on RUN_STARTED', async () => {
    // Pre-populate error info
    apiMock.sendMessage.mockImplementationOnce(async () => {
      emitStreamChunk(conversationId, {
        type: 'RUN_ERROR',
        timestamp: 1,
        error: { message: 'first error' },
      } as StreamChunk)
    })

    const connection1 = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
    const userMessage = {
      id: 'msg-u',
      role: 'user',
      parts: [{ type: 'text', content: 'attempt 1' }],
      createdAt: new Date(),
    } as UIMessage

    const stream1 = connection1.connect([userMessage], undefined, undefined)
    for await (const _chunk of stream1) {
      // consume
    }

    expect(getLastAgentErrorInfo(conversationId)).not.toBeNull()

    // Second run starts — should clear previous error
    apiMock.sendMessage.mockImplementationOnce(async () => {
      emitStreamChunk(conversationId, {
        type: 'RUN_STARTED',
        timestamp: 2,
        runId: 'run-2',
      } as StreamChunk)
      emitStreamChunk(conversationId, {
        type: 'RUN_FINISHED',
        timestamp: 3,
        runId: 'run-2',
        finishReason: 'stop',
      } as StreamChunk)
    })

    const connection2 = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
    const stream2 = connection2.connect([userMessage], undefined, undefined)
    for await (const _chunk of stream2) {
      // consume
    }

    expect(getLastAgentErrorInfo(conversationId)).toBeNull()
  })

  it('ignores stream chunks from other conversations', async () => {
    const otherConv = toConversationId('other-conv')

    apiMock.sendMessage.mockImplementationOnce(async () => {
      // Emit to a different conversation — should be ignored
      emitStreamChunk(otherConv, {
        type: 'RUN_FINISHED',
        timestamp: 1,
        runId: 'r-other',
        finishReason: 'stop',
      } as StreamChunk)
      // Then emit terminal to the correct conversation
      emitStreamChunk(conversationId, {
        type: 'RUN_FINISHED',
        timestamp: 2,
        runId: 'r-correct',
        finishReason: 'stop',
      } as StreamChunk)
      emitRunCompleted(otherConv)
      emitRunCompleted(conversationId)
    })

    const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
    const userMessage = {
      id: 'msg-u',
      role: 'user',
      parts: [{ type: 'text', content: 'check filtering' }],
      createdAt: new Date(),
    } as UIMessage

    const stream = connection.connect([userMessage], undefined, undefined)
    const chunks: StreamChunk[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    // Only the chunk for this conversation should be yielded
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.type).toBe('RUN_FINISHED')
  })

  it('produces RUN_ERROR chunk when sendMessage rejects', async () => {
    apiMock.sendMessage.mockRejectedValueOnce(new Error('IPC channel broken'))

    const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
    const userMessage = {
      id: 'msg-u',
      role: 'user',
      parts: [{ type: 'text', content: 'should fail' }],
      createdAt: new Date(),
    } as UIMessage

    const stream = connection.connect([userMessage], undefined, undefined)
    const chunks: StreamChunk[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(chunks.length).toBeGreaterThanOrEqual(1)
    const errorChunk = chunks.find((c) => c.type === 'RUN_ERROR')
    expect(errorChunk).toBeDefined()
    expect(errorChunk?.type === 'RUN_ERROR' && errorChunk.error.message).toBe('IPC channel broken')

    // Error info should be captured in the side-channel
    const info = getLastAgentErrorInfo(conversationId)
    expect(info).not.toBeNull()
  })

  it('produces RUN_ERROR chunk when sendMessage rejects with non-Error', async () => {
    apiMock.sendMessage.mockRejectedValueOnce('string rejection')

    const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
    const userMessage = {
      id: 'msg-u',
      role: 'user',
      parts: [{ type: 'text', content: 'fail again' }],
      createdAt: new Date(),
    } as UIMessage

    const stream = connection.connect([userMessage], undefined, undefined)
    const chunks: StreamChunk[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    const errorChunk = chunks.find((c) => c.type === 'RUN_ERROR')
    expect(errorChunk).toBeDefined()
    expect(errorChunk?.type === 'RUN_ERROR' && errorChunk.error.message).toBe('string rejection')
  })

  it('sends waggle message when waggle config is provided', async () => {
    apiMock.sendWaggleMessage.mockImplementationOnce(async () => {
      emitStreamChunk(conversationId, {
        type: 'RUN_FINISHED',
        timestamp: 1,
        runId: 'wag-1',
        finishReason: 'stop',
      } as StreamChunk)
    })

    const waggleConfig = { enabled: true, mode: 'review' as const, participants: 2 }
    const connection = createIpcConnectionAdapter(
      conversationId,
      model,
      () => null,
      'medium',
      () => waggleConfig,
    )
    const userMessage = {
      id: 'msg-u',
      role: 'user',
      parts: [{ type: 'text', content: 'review this' }],
      createdAt: new Date(),
    } as UIMessage

    const stream = connection.connect([userMessage], undefined, undefined)
    for await (const _chunk of stream) {
      // consume
    }

    expect(apiMock.sendWaggleMessage).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({ text: 'review this' }),
      waggleConfig,
    )
    expect(apiMock.sendMessage).not.toHaveBeenCalled()
  })

  it('falls back to regular send when waggle config consumer returns null', async () => {
    apiMock.sendMessage.mockImplementationOnce(async () => {
      emitStreamChunk(conversationId, {
        type: 'RUN_FINISHED',
        timestamp: 1,
        runId: 'r-1',
        finishReason: 'stop',
      } as StreamChunk)
    })

    const connection = createIpcConnectionAdapter(
      conversationId,
      model,
      () => null,
      'medium',
      () => null,
    )
    const userMessage = {
      id: 'msg-u',
      role: 'user',
      parts: [{ type: 'text', content: 'normal send' }],
      createdAt: new Date(),
    } as UIMessage

    const stream = connection.connect([userMessage], undefined, undefined)
    for await (const _chunk of stream) {
      // consume
    }

    expect(apiMock.sendMessage).toHaveBeenCalled()
    expect(apiMock.sendWaggleMessage).not.toHaveBeenCalled()
  })

  it('returns RUN_ERROR when connect is called with no message context', async () => {
    const connection = createIpcConnectionAdapter(conversationId, model, () => null, 'medium')
    const stream = connection.connect([], undefined, undefined)
    const chunks: StreamChunk[] = []

    for await (const _chunk of stream) {
      chunks.push(_chunk)
    }

    expect(apiMock.sendMessage).not.toHaveBeenCalled()
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.type).toBe('RUN_ERROR')
  })
})
