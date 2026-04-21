// @vitest-environment jsdom

import type { AgentSendPayload } from '@shared/types/agent'
import { ConversationId, MessageId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { UIMessage } from '@tanstack/ai-react'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { Dispatch, SetStateAction } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentChat } from '../useAgentChat'
import { reconcileSnapshotUserMessages } from '../useAgentChat.utils'

const {
  apiMock,
  createIpcConnectionAdapterMock,
  hasActiveRunMock,
  useBackgroundRunStoreMock,
  upsertConversationMock,
  useChatStoreMock,
  runCompletedHandlers,
  useChatMockImplementation,
} = vi.hoisted(() => ({
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
  hasActiveRunMock: vi.fn(() => false),
  useBackgroundRunStoreMock: vi.fn(
    (selector: (state: { hasActiveRun: (conversationId: string) => boolean }) => unknown) =>
      selector({
        hasActiveRun: hasActiveRunMock,
      }),
  ),
  upsertConversationMock: vi.fn(),
  useChatStoreMock: vi.fn(
    (selector: (state: { upsertConversation: (value: unknown) => void }) => unknown) =>
      selector({
        upsertConversation: upsertConversationMock,
      }),
  ),
  runCompletedHandlers: [] as Array<(payload: { conversationId: string }) => void>,
  useChatMockImplementation: vi.fn(),
}))

vi.mock('@tanstack/ai-react', async () => {
  const React = await import('react')

  return {
    useChat: (options: unknown) => useChatMockImplementation(options, React),
  }
})

vi.mock('@/lib/ipc', () => ({
  api: apiMock,
}))

vi.mock('@/lib/ipc-connection-adapter', () => ({
  createIpcConnectionAdapter: createIpcConnectionAdapterMock,
}))

vi.mock('@/stores/background-run-store', () => ({
  useBackgroundRunStore: useBackgroundRunStoreMock,
}))

vi.mock('@/stores/chat-store', () => ({
  useChatStore: useChatStoreMock,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
    cancelQueries: vi.fn(),
  }),
  QueryClient: vi.fn(),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}))

function createTextUIMessage(id: string, role: UIMessage['role'], content: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', content }],
  }
}

describe('useAgentChat', () => {
  beforeEach(() => {
    apiMock.onStreamChunk.mockClear()
    apiMock.onRunCompleted.mockClear()
    apiMock.getBackgroundRun.mockReset()
    apiMock.getConversation.mockReset()
    createIpcConnectionAdapterMock.mockClear()
    hasActiveRunMock.mockReset()
    hasActiveRunMock.mockReturnValue(false)
    upsertConversationMock.mockReset()
    useChatStoreMock.mockClear()
    runCompletedHandlers.length = 0
    useChatMockImplementation.mockReset()
    useChatMockImplementation.mockImplementation(
      (_options: unknown, React: typeof import('react')) => {
        const [messages, setMessages] = React.useState<UIMessage[]>([])
        const sendMessage = vi.fn(async (_message: string) => {})
        const stop = vi.fn()
        const addToolApprovalResponse = vi.fn(
          async (_response: { id: string; approved: boolean }) => {},
        )

        return {
          messages,
          sendMessage,
          isLoading: false,
          status: 'ready' as const,
          stop,
          setMessages,
          error: undefined,
          addToolApprovalResponse,
        }
      },
    )
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
      expect(upsertConversationMock).toHaveBeenCalledWith(completedConversation)
    })
    expect(result.current.messages).toBeDefined()
  })

  it('does not clobber an optimistic steered user turn when an older run-completed event arrives', async () => {
    const conversationId = ConversationId('conv-steer')
    const persistedConversation: Conversation = {
      id: conversationId,
      title: 'Steer conversation',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: MessageId('msg-existing-user'),
          role: 'user',
          createdAt: 1,
          parts: [{ type: 'text', text: 'Original prompt' }],
        },
        {
          id: MessageId('msg-existing-assistant'),
          role: 'assistant',
          createdAt: 2,
          parts: [{ type: 'text', text: 'Partial answer' }],
        },
      ],
    }

    let setLoading: ((value: boolean) => void) | null = null
    let resolveSendMessage: (() => void) | null = null

    useChatMockImplementation.mockImplementation(
      (_options: unknown, React: typeof import('react')) => {
        const [messages, setMessages] = React.useState<UIMessage[]>([])
        const [isLoading, updateLoading] = React.useState(false)
        setLoading = updateLoading

        const sendMessage = vi.fn(async (message: string) => {
          setMessages((prev) => [...prev, createTextUIMessage('optimistic-user', 'user', message)])
          updateLoading(true)
          await new Promise<void>((resolve) => {
            resolveSendMessage = resolve
          })
        })

        return {
          messages,
          sendMessage,
          isLoading,
          status: isLoading ? ('streaming' as const) : ('ready' as const),
          stop: vi.fn(),
          setMessages,
          error: undefined,
          addToolApprovalResponse: vi.fn(async () => {}),
        }
      },
    )

    apiMock.getConversation.mockResolvedValue({
      ...persistedConversation,
      updatedAt: 2,
      messages: [
        ...persistedConversation.messages,
        {
          id: MessageId('msg-steered-user'),
          role: 'user',
          createdAt: 3,
          parts: [{ type: 'text', text: 'Steered follow-up' }],
        },
      ],
    })

    const { result } = renderHook(() =>
      useAgentChat(
        conversationId,
        persistedConversation,
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    let sendPromise: Promise<void> | null = null

    act(() => {
      sendPromise = result.current.sendMessage({
        text: 'Steered follow-up',
        qualityPreset: 'medium',
        attachments: [],
      } satisfies AgentSendPayload)
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(true)
    })

    await waitFor(() => {
      expect(
        result.current.messages.some(
          (message) =>
            message.role === 'user' &&
            message.parts.some(
              (part) =>
                part.type === 'text' &&
                ('content' in part ? part.content : part.text) === 'Steered follow-up',
            ),
        ),
      ).toBe(true)
    })

    act(() => {
      runCompletedHandlers[0]?.({ conversationId: 'conv-steer' })
    })

    await waitFor(() => {
      expect(
        result.current.messages.some(
          (message) =>
            message.role === 'user' &&
            message.parts.some(
              (part) =>
                part.type === 'text' &&
                ('content' in part ? part.content : part.text) === 'Steered follow-up',
            ),
        ),
      ).toBe(true)
    })

    act(() => {
      setLoading?.(false)
      resolveSendMessage?.()
    })

    await act(async () => {
      await sendPromise
    })

    await waitFor(() => {
      expect(apiMock.getConversation).toHaveBeenCalledWith(conversationId)
    })
  })

  it('defers snapshot hydration even when run-completed arrives immediately after a normal send starts', async () => {
    const conversationId = ConversationId('conv-normal-send-race')
    const persistedConversation: Conversation = {
      id: conversationId,
      title: 'Normal send race',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: MessageId('msg-race-user'),
          role: 'user',
          createdAt: 1,
          parts: [{ type: 'text', text: 'Original prompt' }],
        },
        {
          id: MessageId('msg-race-assistant'),
          role: 'assistant',
          createdAt: 2,
          parts: [{ type: 'text', text: 'Existing answer' }],
        },
      ],
    }

    let resolveSendMessage: (() => void) | null = null

    useChatMockImplementation.mockImplementation(
      (_options: unknown, React: typeof import('react')) => {
        const [messages, setMessages] = React.useState<UIMessage[]>([])
        const [isLoading, setIsLoading] = React.useState(false)

        const sendMessage = vi.fn(async (message: string) => {
          setMessages((prev) => [
            ...prev,
            createTextUIMessage('optimistic-normal-user', 'user', message),
          ])
          setIsLoading(true)
          await new Promise<void>((resolve) => {
            resolveSendMessage = resolve
          })
          setIsLoading(false)
        })

        return {
          messages,
          sendMessage,
          isLoading,
          status: isLoading ? ('streaming' as const) : ('ready' as const),
          stop: vi.fn(),
          setMessages,
          error: undefined,
          addToolApprovalResponse: vi.fn(async () => {}),
        }
      },
    )

    apiMock.getConversation.mockResolvedValue({
      ...persistedConversation,
      updatedAt: 2,
      messages: [
        ...persistedConversation.messages,
        {
          id: MessageId('msg-race-persisted-user'),
          role: 'user',
          createdAt: 3,
          parts: [{ type: 'text', text: 'Did you check the code at all?' }],
        },
      ],
    })

    const { result } = renderHook(() =>
      useAgentChat(
        conversationId,
        persistedConversation,
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    let sendPromise: Promise<void> | null = null

    act(() => {
      sendPromise = result.current.sendMessage({
        text: 'Did you check the code at all?',
        qualityPreset: 'medium',
        attachments: [],
      } satisfies AgentSendPayload)
      runCompletedHandlers[0]?.({ conversationId: 'conv-normal-send-race' })
    })

    expect(apiMock.getConversation).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(
        result.current.messages.some(
          (message) =>
            message.role === 'user' &&
            message.parts.some(
              (part) =>
                part.type === 'text' &&
                ('content' in part ? part.content : part.text) === 'Did you check the code at all?',
            ),
        ),
      ).toBe(true)
    })

    act(() => {
      resolveSendMessage?.()
    })

    await act(async () => {
      await sendPromise
    })

    await waitFor(() => {
      expect(apiMock.getConversation).toHaveBeenCalledWith(conversationId)
    })
  })

  it('loads persisted messages when conversation changes', async () => {
    const conversationId = ConversationId('conv-persisted-load')
    const persistedConversation: Conversation = {
      id: conversationId,
      title: 'Persisted load',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: MessageId('msg-load-user'),
          role: 'user',
          createdAt: 1,
          parts: [{ type: 'text', text: 'Original prompt' }],
        },
        {
          id: MessageId('msg-load-assistant'),
          role: 'assistant',
          createdAt: 2,
          parts: [{ type: 'text', text: 'Existing answer' }],
        },
      ],
    }

    const { result } = renderHook(() =>
      useAgentChat(
        conversationId,
        persistedConversation,
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await waitFor(() => {
      expect(result.current.messages.length).toBeGreaterThan(0)
    })

    expect(
      result.current.messages.some(
        (message) =>
          message.role === 'user' &&
          message.parts.some(
            (part) =>
              part.type === 'text' &&
              ('content' in part ? part.content : part.text) === 'Original prompt',
          ),
      ),
    ).toBe(true)
  })

  it('does not reconnect to background snapshots while a foreground send is active', async () => {
    const conversationId = ConversationId('conv-foreground-priority')
    const baseConversation: Conversation = {
      id: conversationId,
      title: 'Foreground priority',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [],
    }

    let hasActiveRun = false
    hasActiveRunMock.mockImplementation(() => hasActiveRun)
    let resolveSendMessage: (() => void) | null = null

    useChatMockImplementation.mockImplementation(
      (_options: unknown, React: typeof import('react')) => {
        const [messages, setMessages] = React.useState<UIMessage[]>([])
        const sendMessage = vi.fn(async (message: string) => {
          setMessages((prev) => [...prev, createTextUIMessage('optimistic-user', 'user', message)])
          await new Promise<void>((resolve) => {
            resolveSendMessage = resolve
          })
        })

        return {
          messages,
          sendMessage,
          isLoading: true,
          status: 'streaming' as const,
          stop: vi.fn(),
          setMessages,
          error: undefined,
          addToolApprovalResponse: vi.fn(async () => {}),
        }
      },
    )

    const { result, rerender } = renderHook(
      ({ activeConversation }: { activeConversation: Conversation | null }) =>
        useAgentChat(
          conversationId,
          activeConversation,
          SupportedModelId('claude-sonnet-4-5'),
          'medium',
        ),
      { initialProps: { activeConversation: baseConversation } },
    )

    let pendingSend: Promise<void> | null = null
    await act(async () => {
      pendingSend = result.current.sendMessage({
        text: 'keep my user turn visible',
        qualityPreset: 'medium',
        attachments: [],
      } satisfies AgentSendPayload)
    })

    hasActiveRun = true
    rerender({
      activeConversation: {
        ...baseConversation,
        updatedAt: 2,
      },
    })

    expect(apiMock.getBackgroundRun).not.toHaveBeenCalled()

    act(() => {
      resolveSendMessage?.()
    })

    await act(async () => {
      await pendingSend
    })
  })

  it('defers snapshot hydration for the full steer-to-follow-up transition', async () => {
    const conversationId = ConversationId('conv-steer-gap')
    const persistedConversation: Conversation = {
      id: conversationId,
      title: 'Steer gap conversation',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: MessageId('msg-gap-user'),
          role: 'user',
          createdAt: 1,
          parts: [{ type: 'text', text: 'Original prompt' }],
        },
        {
          id: MessageId('msg-gap-assistant'),
          role: 'assistant',
          createdAt: 2,
          parts: [{ type: 'text', text: 'Partial answer' }],
        },
      ],
    }

    let setLoading: ((value: boolean) => void) | null = null
    let resolveSendMessage: (() => void) | null = null

    useChatMockImplementation.mockImplementation(
      (_options: unknown, React: typeof import('react')) => {
        const [messages, setMessages] = React.useState<UIMessage[]>([])
        const [isLoading, updateLoading] = React.useState(false)
        setLoading = updateLoading

        const sendMessage = vi.fn(async (message: string) => {
          setMessages((prev) => [
            ...prev,
            createTextUIMessage('optimistic-gap-user', 'user', message),
          ])
          updateLoading(true)
          await new Promise<void>((resolve) => {
            resolveSendMessage = resolve
          })
        })

        return {
          messages,
          sendMessage,
          isLoading,
          status: isLoading ? ('streaming' as const) : ('ready' as const),
          stop: vi.fn(),
          setMessages,
          error: undefined,
          addToolApprovalResponse: vi.fn(async () => {}),
        }
      },
    )

    apiMock.getConversation.mockResolvedValue({
      ...persistedConversation,
      updatedAt: 2,
      messages: [
        ...persistedConversation.messages,
        {
          id: MessageId('msg-gap-steered-user'),
          role: 'user',
          createdAt: 3,
          parts: [{ type: 'text', text: 'Steered follow-up' }],
        },
      ],
    })

    const { result } = renderHook(() =>
      useAgentChat(
        conversationId,
        persistedConversation,
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    let transitionPromise: Promise<void> | null = null

    act(() => {
      transitionPromise = result.current.withDeferredSnapshotRefresh(async () => {
        runCompletedHandlers[0]?.({ conversationId: 'conv-steer-gap' })
        await result.current.sendMessage({
          text: 'Steered follow-up',
          qualityPreset: 'medium',
          attachments: [],
        } satisfies AgentSendPayload)
      })
    })

    expect(apiMock.getConversation).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(
        result.current.messages.some(
          (message) =>
            message.role === 'user' &&
            message.parts.some(
              (part) =>
                part.type === 'text' &&
                ('content' in part ? part.content : part.text) === 'Steered follow-up',
            ),
        ),
      ).toBe(true)
    })

    act(() => {
      setLoading?.(false)
      resolveSendMessage?.()
    })

    await act(async () => {
      await transitionPromise
    })

    await waitFor(() => {
      expect(apiMock.getConversation).toHaveBeenCalledWith(conversationId)
    })
  })

  it('renders a steered user turn immediately and keeps it ahead of new assistant output', async () => {
    const conversationId = ConversationId('conv-steer-preview')
    const persistedConversation: Conversation = {
      id: conversationId,
      title: 'Steer preview conversation',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: MessageId('msg-preview-user'),
          role: 'user',
          createdAt: 1,
          parts: [{ type: 'text', text: 'Original prompt' }],
        },
        {
          id: MessageId('msg-preview-assistant'),
          role: 'assistant',
          createdAt: 2,
          parts: [{ type: 'text', text: 'Partial answer' }],
        },
      ],
    }

    let updateMessages: Dispatch<SetStateAction<UIMessage[]>> | null = null

    useChatMockImplementation.mockImplementation(
      (_options: unknown, React: typeof import('react')) => {
        const [messages, setMessages] = React.useState<UIMessage[]>([])
        updateMessages = setMessages

        return {
          messages,
          sendMessage: vi.fn(async () => {}),
          isLoading: false,
          status: 'ready' as const,
          stop: vi.fn(),
          setMessages,
          error: undefined,
          addToolApprovalResponse: vi.fn(async () => {}),
        }
      },
    )

    const { result } = renderHook(() =>
      useAgentChat(
        conversationId,
        persistedConversation,
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    act(() => {
      result.current.previewSteeredUserTurn({
        text: 'Steered follow-up',
        qualityPreset: 'medium',
        attachments: [],
      })
    })

    await waitFor(() => {
      expect(result.current.messages.at(-1)?.role).toBe('user')
      expect(result.current.messages.at(-1)?.parts[0]).toEqual({
        type: 'text',
        content: 'Steered follow-up',
      })
    })

    act(() => {
      updateMessages?.((prev) => [
        ...prev,
        createTextUIMessage('assistant-after-steer', 'assistant', 'Working on the follow-up'),
      ])
    })

    await waitFor(() => {
      expect(result.current.messages.slice(-2).map((message) => message.role)).toEqual([
        'user',
        'assistant',
      ])
      expect(result.current.messages.at(-2)?.parts[0]).toEqual({
        type: 'text',
        content: 'Steered follow-up',
      })
    })

    act(() => {
      updateMessages?.([
        createTextUIMessage('persisted-preview-user', 'user', 'Original prompt'),
        createTextUIMessage('persisted-preview-assistant', 'assistant', 'Partial answer'),
        createTextUIMessage('persisted-steered-user', 'user', 'Steered follow-up'),
        createTextUIMessage('assistant-after-persist', 'assistant', 'Now persisted'),
      ])
    })

    await waitFor(() => {
      expect(
        result.current.messages.filter(
          (message) =>
            message.role === 'user' &&
            message.parts.some(
              (part) => part.type === 'text' && part.content === 'Steered follow-up',
            ),
        ),
      ).toHaveLength(1)
      expect(result.current.messages.slice(-2).map((message) => message.role)).toEqual([
        'user',
        'assistant',
      ])
    })
  })

  it('keeps the steered user turn visible when a transient matching user message disappears mid-run', async () => {
    const conversationId = ConversationId('conv-steer-transient-user')
    const persistedConversation: Conversation = {
      id: conversationId,
      title: 'Transient steered user',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: MessageId('msg-transient-user'),
          role: 'user',
          createdAt: 1,
          parts: [{ type: 'text', text: 'Original prompt' }],
        },
        {
          id: MessageId('msg-transient-assistant'),
          role: 'assistant',
          createdAt: 2,
          parts: [{ type: 'text', text: 'Partial answer' }],
        },
      ],
    }

    let updateMessages: Dispatch<SetStateAction<UIMessage[]>> | null = null
    let updateLoading: Dispatch<SetStateAction<boolean>> | null = null

    useChatMockImplementation.mockImplementation(
      (_options: unknown, React: typeof import('react')) => {
        const [messages, setMessages] = React.useState<UIMessage[]>([])
        const [isLoading, setIsLoading] = React.useState(false)
        updateMessages = setMessages
        updateLoading = setIsLoading

        return {
          messages,
          sendMessage: vi.fn(async () => {}),
          isLoading,
          status: isLoading ? ('streaming' as const) : ('ready' as const),
          stop: vi.fn(),
          setMessages,
          error: undefined,
          addToolApprovalResponse: vi.fn(async () => {}),
        }
      },
    )

    const { result } = renderHook(() =>
      useAgentChat(
        conversationId,
        persistedConversation,
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    act(() => {
      result.current.previewSteeredUserTurn({
        text: 'Did you actually read the code at all?',
        qualityPreset: 'medium',
        attachments: [],
      })
    })

    await waitFor(() => {
      expect(
        result.current.messages.some(
          (message) =>
            message.role === 'user' &&
            message.parts.some(
              (part) =>
                part.type === 'text' &&
                ('content' in part ? part.content : part.text) ===
                  'Did you actually read the code at all?',
            ),
        ),
      ).toBe(true)
    })

    act(() => {
      updateMessages?.((prev) => [
        ...prev,
        createTextUIMessage(
          'transient-steered-user',
          'user',
          'Did you actually read the code at all?',
        ),
      ])
      updateLoading?.(true)
    })

    await waitFor(() => {
      expect(
        result.current.messages.filter(
          (message) =>
            message.role === 'user' &&
            message.parts.some(
              (part) =>
                part.type === 'text' &&
                ('content' in part ? part.content : part.text) ===
                  'Did you actually read the code at all?',
            ),
        ),
      ).toHaveLength(1)
    })

    act(() => {
      updateMessages?.((prev) =>
        prev
          .filter((message) => message.id !== 'transient-steered-user')
          .concat(
            createTextUIMessage('assistant-during-retry', 'assistant', 'Still working on it'),
          ),
      )
    })

    await waitFor(() => {
      const matchingUserMessages = result.current.messages.filter(
        (message) =>
          message.role === 'user' &&
          message.parts.some(
            (part) =>
              part.type === 'text' &&
              ('content' in part ? part.content : part.text) ===
                'Did you actually read the code at all?',
          ),
      )
      expect(matchingUserMessages).toHaveLength(1)
      expect(result.current.messages.slice(-2).map((message) => message.role)).toEqual([
        'user',
        'assistant',
      ])
    })

    act(() => {
      updateMessages?.((prev) => [
        ...prev,
        createTextUIMessage(
          'persisted-steered-user',
          'user',
          'Did you actually read the code at all?',
        ),
      ])
      updateLoading?.(false)
    })

    await waitFor(() => {
      expect(
        result.current.messages.filter(
          (message) =>
            message.role === 'user' &&
            message.parts.some(
              (part) =>
                part.type === 'text' &&
                ('content' in part ? part.content : part.text) ===
                  'Did you actually read the code at all?',
            ),
        ),
      ).toHaveLength(1)
    })
  })

  it('keeps the IPC connection stable across rerenders for the same conversation config', async () => {
    const conversation: Conversation = {
      id: ConversationId('conv-stable'),
      title: 'Stable connection',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: MessageId('msg-stable'),
          role: 'assistant',
          createdAt: 1,
          parts: [
            {
              type: 'tool-call',
              toolCall: {
                id: ToolCallId('tool-stable'),
                name: 'writeFile',
                args: { path: 'stable.txt' },
                state: 'approval-requested',
                approval: {
                  id: 'approval_tool-stable',
                  needsApproval: true,
                },
              },
            },
          ],
        },
      ],
    }

    const { rerender } = renderHook(
      ({ activeConversation }: { activeConversation: Conversation | null }) =>
        useAgentChat(
          ConversationId('conv-stable'),
          activeConversation,
          SupportedModelId('claude-sonnet-4-5'),
          'medium',
        ),
      {
        initialProps: {
          activeConversation: conversation,
        },
      },
    )

    await waitFor(() => {
      expect(createIpcConnectionAdapterMock).toHaveBeenCalledTimes(1)
    })

    rerender({ activeConversation: conversation })

    await waitFor(() => {
      expect(createIpcConnectionAdapterMock).toHaveBeenCalledTimes(1)
    })
  })

  it('deduplicates persisted user message against optimistic user message on snapshot refresh', () => {
    // This tests reconcileSnapshotUserMessages directly — the function
    // that prevents duplicate user messages when a persisted snapshot
    // is loaded after a stream completes.
    //
    // TanStack creates optimistic user messages with IDs like `msg-{timestamp}-{random}`.
    // Persisted messages use UUIDs from crypto.randomUUID().
    // Same text, different IDs → would appear as duplicates without reconciliation.
    const userText = 'Please deduplicate this user turn'
    const optimisticUserId = 'msg-1710340000000-abc123'
    const persistedUserId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

    const existingMessages: UIMessage[] = [
      createTextUIMessage(optimisticUserId, 'user', userText),
      createTextUIMessage('msg-assistant-1', 'assistant', 'Working on it...'),
    ]

    const snapshotMessages: UIMessage[] = [
      createTextUIMessage(persistedUserId, 'user', userText),
      createTextUIMessage('msg-assistant-final', 'assistant', 'Final answer'),
    ]

    const reconciled = reconcileSnapshotUserMessages(snapshotMessages, existingMessages)

    // The persisted user message should be replaced by the optimistic one
    const userMessages = reconciled.filter((m: UIMessage) => m.role === 'user')
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0].id).toBe(optimisticUserId)

    // Assistant messages are untouched
    const assistantMessages = reconciled.filter((m: UIMessage) => m.role === 'assistant')
    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0].id).toBe('msg-assistant-final')
  })

  it('does not deduplicate when user message texts differ', () => {
    const existingMessages: UIMessage[] = [
      createTextUIMessage('msg-optimistic', 'user', 'First question'),
    ]

    const snapshotMessages: UIMessage[] = [
      createTextUIMessage('persisted-uuid', 'user', 'Different question'),
      createTextUIMessage('msg-assistant', 'assistant', 'Answer'),
    ]

    const reconciled = reconcileSnapshotUserMessages(snapshotMessages, existingMessages)

    // No match → snapshot returned as-is
    expect(reconciled).toBe(snapshotMessages)
  })
})
