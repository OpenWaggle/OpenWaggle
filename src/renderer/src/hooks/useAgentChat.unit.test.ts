// @vitest-environment jsdom

import { ConversationId, MessageId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentChat } from './useAgentChat'

const { apiMock, createIpcConnectionAdapterMock, useBackgroundRunStoreMock, runCompletedHandlers } =
  vi.hoisted(() => ({
    apiMock: {
      onStreamChunk: vi.fn(() => () => {}),
      onRunCompleted: vi.fn((handler: (payload: { conversationId: string }) => void) => {
        runCompletedHandlers.push(handler)
        return () => {}
      }),
      getBackgroundRun: vi.fn(async () => null),
      getConversation: vi.fn(async () => null),
      cancelAgent: vi.fn(),
      steerAgent: vi.fn(),
      answerQuestion: vi.fn(),
      respondToPlan: vi.fn(),
    },
    createIpcConnectionAdapterMock: vi.fn(() => ({
      connect: async function* emptyAsyncIterable() {
        yield* []
      },
    })),
    useBackgroundRunStoreMock: vi.fn(
      (selector: (state: { hasActiveRun: (conversationId: string) => boolean }) => unknown) =>
        selector({
          hasActiveRun: () => false,
        }),
    ),
    runCompletedHandlers: [] as Array<(payload: { conversationId: string }) => void>,
  }))

vi.mock('@/lib/ipc', () => ({
  api: apiMock,
}))

vi.mock('@/lib/ipc-connection-adapter', () => ({
  createIpcConnectionAdapter: createIpcConnectionAdapterMock,
}))

vi.mock('@/stores/background-run-store', () => ({
  useBackgroundRunStore: useBackgroundRunStoreMock,
}))

describe('useAgentChat', () => {
  beforeEach(() => {
    apiMock.onStreamChunk.mockClear()
    apiMock.onRunCompleted.mockClear()
    apiMock.getBackgroundRun.mockReset()
    apiMock.getConversation.mockReset()
    runCompletedHandlers.length = 0
  })

  it('restores persisted approval metadata after hydrating historical messages', async () => {
    const conversation: Conversation = {
      id: ConversationId('conv-1'),
      title: 'Pending approval',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: MessageId('msg-1'),
          role: 'assistant',
          createdAt: 1,
          parts: [
            {
              type: 'tool-call',
              toolCall: {
                id: ToolCallId('tool-restore'),
                name: 'writeFile',
                args: { path: 'pending.txt' },
                state: 'approval-requested',
                approval: {
                  id: 'approval_tool-restore',
                  needsApproval: true,
                },
              },
            },
          ],
        },
      ],
    }

    const { result } = renderHook(() =>
      useAgentChat(
        ConversationId('conv-1'),
        conversation,
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await waitFor(() => {
      expect(result.current.messages[0]?.parts[0]).toEqual({
        type: 'tool-call',
        id: 'tool-restore',
        name: 'writeFile',
        arguments: '{"path":"pending.txt"}',
        state: 'approval-requested',
        approval: {
          id: 'approval_tool-restore',
          needsApproval: true,
        },
      })
    })
  })

  it('reloads historical messages when the active conversation appears after a thread switch', async () => {
    const conversation: Conversation = {
      id: ConversationId('conv-switch'),
      title: 'Pending approval',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: MessageId('msg-switch'),
          role: 'assistant',
          createdAt: 1,
          parts: [
            {
              type: 'tool-call',
              toolCall: {
                id: ToolCallId('tool-switch'),
                name: 'writeFile',
                args: { path: 'switch.txt' },
                state: 'approval-requested',
                approval: {
                  id: 'approval_tool-switch',
                  needsApproval: true,
                },
              },
            },
          ],
        },
      ],
    }
    const initialProps: {
      conversationId: ReturnType<typeof ConversationId>
      activeConversation: Conversation | null
    } = {
      conversationId: ConversationId('conv-switch'),
      activeConversation: null,
    }

    const { result, rerender } = renderHook(
      ({ conversationId, activeConversation }) =>
        useAgentChat(
          conversationId,
          activeConversation,
          SupportedModelId('claude-sonnet-4-5'),
          'medium',
        ),
      {
        initialProps,
      },
    )

    rerender({
      conversationId: ConversationId('conv-switch'),
      activeConversation: conversation,
    })

    await waitFor(() => {
      expect(result.current.messages[0]?.parts[0]).toEqual({
        type: 'tool-call',
        id: 'tool-switch',
        name: 'writeFile',
        arguments: '{"path":"switch.txt"}',
        state: 'approval-requested',
        approval: {
          id: 'approval_tool-switch',
          needsApproval: true,
        },
      })
    })
  })

  it('reloads the active conversation from disk when the run completes', async () => {
    const pendingConversation: Conversation = {
      id: ConversationId('conv-complete'),
      title: 'Pending approval',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: MessageId('msg-pending'),
          role: 'assistant',
          createdAt: 1,
          parts: [
            {
              type: 'tool-call',
              toolCall: {
                id: ToolCallId('tool-complete'),
                name: 'writeFile',
                args: { path: 'complete.txt' },
                state: 'approval-requested',
                approval: {
                  id: 'approval_tool-complete',
                  needsApproval: true,
                },
              },
            },
          ],
        },
      ],
    }
    const completedConversation: Conversation = {
      ...pendingConversation,
      updatedAt: 2,
      messages: [
        pendingConversation.messages[0],
        {
          id: MessageId('msg-complete'),
          role: 'assistant',
          createdAt: 2,
          parts: [
            {
              type: 'tool-result',
              toolResult: {
                id: ToolCallId('tool-complete'),
                name: 'writeFile',
                args: { path: 'complete.txt' },
                result: JSON.stringify({ kind: 'text', text: 'done' }),
                isError: false,
                duration: 1,
              },
            },
          ],
        },
      ],
    }
    apiMock.getConversation.mockResolvedValue(completedConversation)

    const { result } = renderHook(() =>
      useAgentChat(
        ConversationId('conv-complete'),
        pendingConversation,
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    runCompletedHandlers[0]?.({ conversationId: 'conv-complete' })

    await waitFor(() => {
      expect(
        result.current.messages.some((message) =>
          message.parts.some(
            (part) => part.type === 'tool-result' && part.toolCallId === 'tool-complete',
          ),
        ),
      ).toBe(true)
    })
  })
})
