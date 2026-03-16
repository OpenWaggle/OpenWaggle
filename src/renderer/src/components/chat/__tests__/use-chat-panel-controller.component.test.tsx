import type { AgentSendPayload } from '@shared/types/agent'
import { ConversationId, SupportedModelId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { WaggleConfig } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/stores/composer-store'
import { useMessageQueueStore } from '@/stores/message-queue-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useUIStore } from '@/stores/ui-store'
import { useWaggleStore } from '@/stores/waggle-store'
import type { PendingApproval } from '../pending-tool-interactions'

const {
  buildChatRowsMock,
  useAgentChatMock,
  useAutoSendQueueMock,
  useChatMock,
  useConversationNavMock,
  useGitMock,
  useMessageModelLookupMock,
  useProjectMock,
  useSendMessageMock,
  useSkillsMock,
  useStreamingPhaseMock,
  useWaggleChatMock,
  useWaggleMetadataLookupMock,
  cancelWaggleMock,
  isProjectToolCallTrustedMock,
  recordProjectToolApprovalMock,
  loggerErrorMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  buildChatRowsMock: vi.fn(() => []),
  useAgentChatMock: vi.fn(),
  useAutoSendQueueMock: vi.fn(),
  useChatMock: vi.fn(),
  useConversationNavMock: vi.fn(),
  useGitMock: vi.fn(),
  useMessageModelLookupMock: vi.fn(),
  useProjectMock: vi.fn(),
  useSendMessageMock: vi.fn(),
  useSkillsMock: vi.fn(),
  useStreamingPhaseMock: vi.fn(),
  useWaggleChatMock: vi.fn(),
  useWaggleMetadataLookupMock: vi.fn(),
  cancelWaggleMock: vi.fn(),
  isProjectToolCallTrustedMock: vi.fn(),
  recordProjectToolApprovalMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}))

vi.mock('@/hooks/useAgentChat', () => ({
  useAgentChat: useAgentChatMock,
}))

vi.mock('@/hooks/useAutoSendQueue', () => ({
  useAutoSendQueue: useAutoSendQueueMock,
}))

vi.mock('@/hooks/useChat', () => ({
  useChat: useChatMock,
}))

vi.mock('@/hooks/useConversationNav', () => ({
  useConversationNav: useConversationNavMock,
}))

vi.mock('@/hooks/useGit', () => ({
  useGit: useGitMock,
}))

vi.mock('@/hooks/useMessageModelLookup', () => ({
  useMessageModelLookup: useMessageModelLookupMock,
}))

vi.mock('@/hooks/useProject', () => ({
  useProject: useProjectMock,
}))

vi.mock('@/hooks/useSendMessage', () => ({
  useSendMessage: useSendMessageMock,
}))

vi.mock('@/hooks/useSkills', () => ({
  useSkills: useSkillsMock,
}))

vi.mock('@/hooks/useStreamingPhase', () => ({
  useStreamingPhase: useStreamingPhaseMock,
}))

vi.mock('@/hooks/useWaggleChat', () => ({
  useWaggleChat: useWaggleChatMock,
}))

vi.mock('@/hooks/useWaggleMetadataLookup', () => ({
  useWaggleMetadataLookup: useWaggleMetadataLookupMock,
}))

vi.mock('@/lib/ipc', () => ({
  api: {
    cancelWaggle: cancelWaggleMock,
    isProjectToolCallTrusted: isProjectToolCallTrustedMock,
    recordProjectToolApproval: recordProjectToolApprovalMock,
  },
}))

vi.mock('@/lib/logger', () => ({
  createRendererLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarnMock,
    error: loggerErrorMock,
  }),
}))

vi.mock('../useChatRows', () => ({
  buildChatRows: buildChatRowsMock,
}))

import { useChatPanelSections } from '../use-chat-panel-controller'

const ACTIVE_CONVERSATION_ID = ConversationId('conv-1')
const DEFAULT_TOOL_ARGS = '{"command":"echo test"}'

function createConversation(): Conversation {
  return {
    id: ACTIVE_CONVERSATION_ID,
    title: 'Current thread',
    projectPath: '/repo',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function createPayload(text: string): AgentSendPayload {
  return {
    text,
    qualityPreset: 'medium',
    attachments: [],
  }
}

function createWaggleConfig(): WaggleConfig {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: SupportedModelId('claude-sonnet-4-5'),
        roleDescription: 'Shapes the first pass.',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: SupportedModelId('claude-opus-4'),
        roleDescription: 'Challenges edge cases.',
        color: 'amber',
      },
    ],
    stop: {
      primary: 'consensus',
      maxTurnsSafety: 8,
    },
  }
}

function createUserMessage(id: string, textParts: readonly string[]): UIMessage {
  return {
    id,
    role: 'user',
    parts: textParts.map((text) => ({
      type: 'text' as const,
      text,
      content: text,
    })),
  } as UIMessage
}

function createResolvedApprovalMessage(
  toolCallId: string,
  approvalId: string,
  toolArgs = DEFAULT_TOOL_ARGS,
): UIMessage {
  return {
    id: `message-${toolCallId}-resolved`,
    role: 'assistant',
    parts: [
      {
        type: 'tool-call',
        id: toolCallId,
        name: 'runCommand',
        arguments: toolArgs,
        state: 'approval-requested',
        approval: {
          id: approvalId,
          needsApproval: true,
        },
      },
      {
        type: 'tool-result',
        toolCallId,
        output: { kind: 'text' as const, text: 'ok' },
        state: 'output-available',
      },
    ],
  } as UIMessage
}

function createPendingApprovalMessage(
  toolCallId: string,
  approvalId: string,
  overrides: {
    toolArgs?: string
    toolName?: string
    hasApprovalMetadata?: boolean
    state?: 'approval-requested' | 'input-complete'
  } = {},
): UIMessage {
  const {
    toolArgs = DEFAULT_TOOL_ARGS,
    toolName = 'runCommand',
    hasApprovalMetadata = true,
    state = 'approval-requested',
  } = overrides

  const part = {
    type: 'tool-call' as const,
    id: toolCallId,
    name: toolName,
    arguments: toolArgs,
    state,
    ...(hasApprovalMetadata
      ? {
          approval: {
            id: approvalId,
            needsApproval: true,
          },
        }
      : {}),
  }

  return {
    id: `message-${toolCallId}-pending`,
    role: 'assistant',
    parts: [part],
  } as UIMessage
}

function createPendingApproval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    toolName: 'runCommand',
    toolArgs: DEFAULT_TOOL_ARGS,
    approvalId: 'approval-1',
    toolCallId: 'tool-1',
    hasApprovalMetadata: true,
    ...overrides,
  }
}

function getAutoSendFailureReporter():
  | ((payload: AgentSendPayload, error: unknown) => void)
  | undefined {
  const candidate = useAutoSendQueueMock.mock.calls[0]?.[0]
  if (typeof candidate !== 'object' || candidate === null) {
    return undefined
  }

  const reporter = Reflect.get(candidate, 'onSendFailure')
  return typeof reporter === 'function' ? reporter : undefined
}

function buildBaseAgentChatReturn(overrides?: Record<string, unknown>) {
  return {
    messages: [],
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendWaggleMessage: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    status: 'ready',
    stop: vi.fn(),
    steer: vi.fn().mockResolvedValue(undefined),
    error: undefined,
    respondToolApproval: vi.fn().mockResolvedValue(undefined),
    answerQuestion: vi.fn().mockResolvedValue(undefined),
    respondToPlan: vi.fn().mockResolvedValue(undefined),
    withDeferredSnapshotRefresh: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    previewSteeredUserTurn: vi.fn(() => vi.fn()),
    backgroundStreaming: false,
    ...overrides,
  }
}

describe('useChatPanelSections', () => {
  beforeEach(() => {
    buildChatRowsMock.mockReset()
    buildChatRowsMock.mockReturnValue([])
    useAgentChatMock.mockReset()
    useAutoSendQueueMock.mockReset()
    useChatMock.mockReset()
    useConversationNavMock.mockReset()
    useGitMock.mockReset()
    useMessageModelLookupMock.mockReset()
    useProjectMock.mockReset()
    useSendMessageMock.mockReset()
    useSkillsMock.mockReset()
    useStreamingPhaseMock.mockReset()
    useWaggleChatMock.mockReset()
    useWaggleMetadataLookupMock.mockReset()
    cancelWaggleMock.mockReset()
    isProjectToolCallTrustedMock.mockReset()
    recordProjectToolApprovalMock.mockReset()
    loggerErrorMock.mockReset()
    loggerWarnMock.mockReset()

    useComposerStore.setState(useComposerStore.getInitialState())
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: DEFAULT_SETTINGS,
      isLoaded: true,
      loadError: null,
    })
    useUIStore.setState(useUIStore.getInitialState())
    useWaggleStore.setState(useWaggleStore.getInitialState())
    useMessageQueueStore.setState({ queues: new Map() })

    useProjectMock.mockReturnValue({
      projectPath: '/repo',
      selectFolder: vi.fn().mockResolvedValue(undefined),
      setProjectPath: vi.fn(),
    })
    useChatMock.mockReturnValue({
      conversations: [createConversation()],
      activeConversation: createConversation(),
      activeConversationId: ACTIVE_CONVERSATION_ID,
      createConversation: vi.fn(),
      setActiveConversation: vi.fn(),
      updateConversationProjectPath: vi.fn(),
    })
    useGitMock.mockReturnValue({
      refreshStatus: vi.fn(),
      refreshBranches: vi.fn(),
    })
    useConversationNavMock.mockReturnValue({
      handleOpenProject: vi.fn().mockResolvedValue(undefined),
      handleSelectProjectPath: vi.fn(),
    })
    useAgentChatMock.mockReturnValue(buildBaseAgentChatReturn())
    useSendMessageMock.mockReturnValue({
      handleSend: vi.fn().mockResolvedValue(undefined),
      handleSendText: vi.fn().mockResolvedValue(undefined),
      handleSendWaggle: vi.fn().mockResolvedValue(undefined),
    })
    useMessageModelLookupMock.mockReturnValue({})
    useWaggleMetadataLookupMock.mockReturnValue({})
    useWaggleChatMock.mockReturnValue(undefined)
    useStreamingPhaseMock.mockReturnValue({
      current: null,
      reset: vi.fn(),
    })
    useSkillsMock.mockReturnValue({
      catalog: {
        skills: [],
      },
    })
    useAutoSendQueueMock.mockImplementation(() => undefined)
    isProjectToolCallTrustedMock.mockResolvedValue(false)
    recordProjectToolApprovalMock.mockResolvedValue(undefined)
  })

  it('passes a send-failure reporter to the auto-send queue that logs and toasts', () => {
    renderHook(() => useChatPanelSections())

    const onSendFailure = getAutoSendFailureReporter()
    expect(onSendFailure).toBeTypeOf('function')

    act(() => {
      onSendFailure?.(createPayload('Retry this message'), new Error('send failed'))
    })

    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to auto-send queued message',
      expect.objectContaining({
        conversationId: ACTIVE_CONVERSATION_ID,
        error: 'send failed',
        queuedText: 'Retry this message',
      }),
    )
    expect(useUIStore.getState().toastMessage).toBe(
      'Queued message failed to send automatically. It stayed in the queue.',
    )
  })

  it('passes the latest user text to virtual row building', () => {
    useAgentChatMock.mockReturnValue(
      buildBaseAgentChatReturn({
        messages: [
          createUserMessage('user-1', ['first draft']),
          {
            id: 'assistant-1',
            role: 'assistant',
            parts: [],
          } as UIMessage,
          createUserMessage('user-2', ['final line one', 'final line two']),
        ],
      }),
    )

    renderHook(() => useChatPanelSections())

    expect(buildChatRowsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastUserMessage: 'final line one\nfinal line two',
      }),
    )
  })

  it('re-enqueues, logs, and toasts when steering a queued message fails', async () => {
    const steer = vi.fn().mockRejectedValue(new Error('steer failed'))
    useAgentChatMock.mockReturnValue(buildBaseAgentChatReturn({ steer }))

    const handleSendWaggle = vi.fn().mockResolvedValue(undefined)
    useSendMessageMock.mockReturnValue({
      handleSend: vi.fn().mockResolvedValue(undefined),
      handleSendText: vi.fn().mockResolvedValue(undefined),
      handleSendWaggle,
    })

    useMessageQueueStore.getState().enqueue(ACTIVE_CONVERSATION_ID, createPayload('Steer me'))
    const queuedItem = useMessageQueueStore.getState().queues.get(ACTIVE_CONVERSATION_ID)?.[0]

    const { result } = renderHook(() => useChatPanelSections())

    await act(async () => {
      await result.current.composer.onSteer(queuedItem?.id ?? '')
    })

    const queue = useMessageQueueStore.getState().queues.get(ACTIVE_CONVERSATION_ID) ?? []
    expect(queue).toHaveLength(1)
    expect(queue[0]?.payload.text).toBe('Steer me')
    expect(handleSendWaggle).not.toHaveBeenCalled()
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to steer queued message',
      expect.objectContaining({
        conversationId: ACTIVE_CONVERSATION_ID,
        messageId: queuedItem?.id,
        error: 'steer failed',
      }),
    )
    expect(useUIStore.getState().toastMessage).toBe(
      'Could not steer the queued message. It was returned to the queue.',
    )
  })

  it('defers snapshot refresh across the full steer-and-send sequence', async () => {
    const steer = vi.fn().mockResolvedValue(undefined)
    const withDeferredSnapshotRefresh = vi.fn(async (operation: () => Promise<unknown>) =>
      operation(),
    )
    const clearOptimisticSteeredTurn = vi.fn()
    const previewSteeredUserTurn = vi.fn(() => clearOptimisticSteeredTurn)
    useAgentChatMock.mockReturnValue(
      buildBaseAgentChatReturn({
        steer,
        withDeferredSnapshotRefresh,
        previewSteeredUserTurn,
      }),
    )

    const handleSend = vi.fn().mockResolvedValue(undefined)
    const handleSendWaggle = vi.fn().mockResolvedValue(undefined)
    useSendMessageMock.mockReturnValue({
      handleSend,
      handleSendText: vi.fn().mockResolvedValue(undefined),
      handleSendWaggle,
    })

    useMessageQueueStore.getState().enqueue(ACTIVE_CONVERSATION_ID, createPayload('Steer me'))
    const queuedItem = useMessageQueueStore.getState().queues.get(ACTIVE_CONVERSATION_ID)?.[0]

    const { result } = renderHook(() => useChatPanelSections())

    await act(async () => {
      await result.current.composer.onSteer(queuedItem?.id ?? '')
    })

    expect(withDeferredSnapshotRefresh).toHaveBeenCalledOnce()
    expect(steer).toHaveBeenCalledOnce()
    expect(previewSteeredUserTurn).toHaveBeenCalledWith(createPayload('Steer me'))
    expect(clearOptimisticSteeredTurn).not.toHaveBeenCalled()
    expect(handleSend).toHaveBeenCalledWith(createPayload('Steer me'))
    expect(handleSendWaggle).not.toHaveBeenCalled()
  })

  it('renders the optimistic steered turn before the steer IPC completes', async () => {
    let resolveSteer: (() => void) | null = null
    const steer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSteer = resolve
        }),
    )
    const previewSteeredUserTurn = vi.fn(() => vi.fn())
    useAgentChatMock.mockReturnValue(
      buildBaseAgentChatReturn({
        steer,
        previewSteeredUserTurn,
      }),
    )

    const handleSend = vi.fn().mockResolvedValue(undefined)
    useSendMessageMock.mockReturnValue({
      handleSend,
      handleSendText: vi.fn().mockResolvedValue(undefined),
      handleSendWaggle: vi.fn().mockResolvedValue(undefined),
    })

    useMessageQueueStore.getState().enqueue(ACTIVE_CONVERSATION_ID, createPayload('Steer me'))
    const queuedItem = useMessageQueueStore.getState().queues.get(ACTIVE_CONVERSATION_ID)?.[0]

    const { result } = renderHook(() => useChatPanelSections())

    act(() => {
      void result.current.composer.onSteer(queuedItem?.id ?? '')
    })

    expect(previewSteeredUserTurn).toHaveBeenCalledWith(createPayload('Steer me'))
    expect(handleSend).not.toHaveBeenCalled()

    await act(async () => {
      resolveSteer?.()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(handleSend).toHaveBeenCalledWith(createPayload('Steer me'))
    })
  })

  it('clears the optimistic steered turn preview when the follow-up send fails', async () => {
    const steer = vi.fn().mockResolvedValue(undefined)
    const clearOptimisticSteeredTurn = vi.fn()
    const previewSteeredUserTurn = vi.fn(() => clearOptimisticSteeredTurn)
    useAgentChatMock.mockReturnValue(buildBaseAgentChatReturn({ steer, previewSteeredUserTurn }))

    const sendError = new Error('send failed')
    const handleSend = vi.fn().mockRejectedValue(sendError)
    useSendMessageMock.mockReturnValue({
      handleSend,
      handleSendText: vi.fn().mockResolvedValue(undefined),
      handleSendWaggle: vi.fn().mockResolvedValue(undefined),
    })

    useMessageQueueStore.getState().enqueue(ACTIVE_CONVERSATION_ID, createPayload('Steer me'))
    const queuedItem = useMessageQueueStore.getState().queues.get(ACTIVE_CONVERSATION_ID)?.[0]

    const { result } = renderHook(() => useChatPanelSections())

    await act(async () => {
      await result.current.composer.onSteer(queuedItem?.id ?? '')
    })

    expect(previewSteeredUserTurn).toHaveBeenCalledWith(createPayload('Steer me'))
    expect(clearOptimisticSteeredTurn).toHaveBeenCalledOnce()
    const queue = useMessageQueueStore.getState().queues.get(ACTIVE_CONVERSATION_ID) ?? []
    expect(queue).toHaveLength(1)
  })

  it('starts waggle collaboration and sends with waggle when a config is ready', async () => {
    const reset = vi.fn()
    const handleSend = vi.fn().mockResolvedValue(undefined)
    const handleSendWaggle = vi.fn().mockResolvedValue(undefined)
    const waggleConfig = createWaggleConfig()
    useStreamingPhaseMock.mockReturnValue({
      current: null,
      reset,
    })
    useSendMessageMock.mockReturnValue({
      handleSend,
      handleSendText: vi.fn().mockResolvedValue(undefined),
      handleSendWaggle,
    })
    useWaggleStore.getState().setConfig(waggleConfig)

    const { result } = renderHook(() => useChatPanelSections())
    const payload = createPayload('Pair on this')

    await act(async () => {
      await result.current.composer.onSendWithWaggle(payload)
    })

    expect(reset).toHaveBeenCalledOnce()
    expect(handleSendWaggle).toHaveBeenCalledWith(payload, waggleConfig)
    expect(handleSend).not.toHaveBeenCalled()
    expect(useWaggleStore.getState().activeCollaborationId).toBe(ACTIVE_CONVERSATION_ID)
    expect(useWaggleStore.getState().status).toBe('running')
  })

  it('falls back to the standard send path when waggle is already running', async () => {
    const reset = vi.fn()
    const handleSend = vi.fn().mockResolvedValue(undefined)
    const handleSendWaggle = vi.fn().mockResolvedValue(undefined)
    const waggleConfig = createWaggleConfig()
    useStreamingPhaseMock.mockReturnValue({
      current: null,
      reset,
    })
    useSendMessageMock.mockReturnValue({
      handleSend,
      handleSendText: vi.fn().mockResolvedValue(undefined),
      handleSendWaggle,
    })
    useWaggleStore.getState().startCollaboration(ACTIVE_CONVERSATION_ID, waggleConfig)

    const { result } = renderHook(() => useChatPanelSections())
    const payload = createPayload('Use the regular path')

    await act(async () => {
      await result.current.composer.onSendWithWaggle(payload)
    })

    expect(reset).toHaveBeenCalledOnce()
    expect(handleSend).toHaveBeenCalledWith(payload)
    expect(handleSendWaggle).not.toHaveBeenCalled()
  })

  it('cancels waggle and stops collaboration', () => {
    useWaggleStore.getState().startCollaboration(ACTIVE_CONVERSATION_ID, createWaggleConfig())

    const { result } = renderHook(() => useChatPanelSections())

    act(() => {
      result.current.composer.onStopCollaboration()
    })

    expect(cancelWaggleMock).toHaveBeenCalledWith(ACTIVE_CONVERSATION_ID)
    expect(useWaggleStore.getState().status).toBe('stopped')
  })

  it('inserts the selected skill into a slash-only prompt', () => {
    useComposerStore.getState().setInput('/')
    useComposerStore.getState().setCursorIndex(1)

    const { result } = renderHook(() => useChatPanelSections())

    act(() => {
      result.current.composer.onSelectSkill('review')
    })

    expect(useComposerStore.getState().input).toBe('/review ')
    expect(useComposerStore.getState().cursorIndex).toBe('/review '.length)
  })

  it('prefixes the selected skill when the composer already has input', () => {
    useComposerStore.getState().setInput('tighten this diff')
    useComposerStore.getState().setCursorIndex('tighten this diff'.length)

    const { result } = renderHook(() => useChatPanelSections())

    act(() => {
      result.current.composer.onSelectSkill('review')
    })

    expect(useComposerStore.getState().input).toBe('/review tighten this diff')
    expect(useComposerStore.getState().cursorIndex).toBe('/review tighten this diff'.length)
  })

  it('persists trust rules after approving a trustable tool', async () => {
    const respondToolApproval = vi.fn().mockResolvedValue(undefined)
    useAgentChatMock.mockReturnValue(buildBaseAgentChatReturn({ respondToolApproval }))

    const { result } = renderHook(() => useChatPanelSections())
    const pendingApproval = createPendingApproval()

    await act(async () => {
      await result.current.composer.onToolApprovalResponse(pendingApproval, true)
    })

    expect(respondToolApproval).toHaveBeenCalledWith('approval-1', true)
    expect(recordProjectToolApprovalMock).toHaveBeenCalledWith(
      '/repo',
      'runCommand',
      DEFAULT_TOOL_ARGS,
    )
  })

  it('does not persist trust rules when the approval is rejected', async () => {
    const respondToolApproval = vi.fn().mockResolvedValue(undefined)
    useAgentChatMock.mockReturnValue(buildBaseAgentChatReturn({ respondToolApproval }))

    const { result } = renderHook(() => useChatPanelSections())

    await act(async () => {
      await result.current.composer.onToolApprovalResponse(createPendingApproval(), false)
    })

    expect(respondToolApproval).toHaveBeenCalledWith('approval-1', false)
    expect(recordProjectToolApprovalMock).not.toHaveBeenCalled()
  })

  it('skips trust persistence in full-access mode', async () => {
    const respondToolApproval = vi.fn().mockResolvedValue(undefined)
    useAgentChatMock.mockReturnValue(buildBaseAgentChatReturn({ respondToolApproval }))
    usePreferencesStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        executionMode: 'full-access',
      },
    }))

    const { result } = renderHook(() => useChatPanelSections())

    await act(async () => {
      await result.current.composer.onToolApprovalResponse(createPendingApproval(), true)
    })

    expect(respondToolApproval).toHaveBeenCalledWith('approval-1', true)
    expect(recordProjectToolApprovalMock).not.toHaveBeenCalled()
  })

  it('warns and toasts when trust persistence fails after approval', async () => {
    const respondToolApproval = vi.fn().mockResolvedValue(undefined)
    useAgentChatMock.mockReturnValue(buildBaseAgentChatReturn({ respondToolApproval }))
    recordProjectToolApprovalMock.mockRejectedValueOnce(new Error('persist failed'))

    const { result } = renderHook(() => useChatPanelSections())

    await act(async () => {
      await result.current.composer.onToolApprovalResponse(createPendingApproval(), true)
    })

    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Failed to persist tool approval trust',
      expect.objectContaining({
        toolName: 'runCommand',
        toolCallId: 'tool-1',
        error: 'persist failed',
      }),
    )
    expect(useUIStore.getState().toastMessage).toBe(
      'Approved. Could not save trust rule; approval may be requested again.',
    )
  })

  it('auto-skips duplicate pending tool calls without re-checking trust', async () => {
    const respondToolApproval = vi.fn().mockResolvedValue(undefined)
    useAgentChatMock.mockReturnValue(
      buildBaseAgentChatReturn({
        messages: [
          createResolvedApprovalMessage('tool-0', 'approval-0'),
          createPendingApprovalMessage('tool-1', 'approval-1'),
        ],
        respondToolApproval,
      }),
    )

    renderHook(() => useChatPanelSections())

    await waitFor(() => {
      expect(respondToolApproval).toHaveBeenCalledWith('approval-1', false)
    })
    expect(isProjectToolCallTrustedMock).not.toHaveBeenCalled()
  })

  it('does not auto-skip matching tool calls from an earlier user turn', async () => {
    const respondToolApproval = vi.fn().mockResolvedValue(undefined)
    useAgentChatMock.mockReturnValue(
      buildBaseAgentChatReturn({
        messages: [
          createUserMessage('user-1', ['first task']),
          createResolvedApprovalMessage('tool-0', 'approval-0'),
          createUserMessage('user-2', ['repeat task intentionally']),
          createPendingApprovalMessage('tool-1', 'approval-1'),
        ],
        respondToolApproval,
      }),
    )

    renderHook(() => useChatPanelSections())

    await waitFor(() => {
      expect(isProjectToolCallTrustedMock).toHaveBeenCalled()
    })
    expect(respondToolApproval).not.toHaveBeenCalledWith('approval-1', false)
  })

  it('trust-checks and auto-approves trusted pending tools', async () => {
    const respondToolApproval = vi.fn().mockResolvedValue(undefined)
    useAgentChatMock.mockReturnValue(
      buildBaseAgentChatReturn({
        messages: [createPendingApprovalMessage('tool-1', 'approval-1')],
        respondToolApproval,
      }),
    )
    isProjectToolCallTrustedMock.mockResolvedValueOnce(true)

    renderHook(() => useChatPanelSections())

    await waitFor(() => {
      expect(isProjectToolCallTrustedMock).toHaveBeenCalledWith(
        '/repo',
        'runCommand',
        DEFAULT_TOOL_ARGS,
      )
    })
    await waitFor(() => {
      expect(respondToolApproval).toHaveBeenCalledWith('approval-1', true)
    })
  })

  it('does not auto-approve when the pending approval resolves before trust check returns', async () => {
    const respondToolApproval = vi.fn().mockResolvedValue(undefined)
    let currentMessages = [createPendingApprovalMessage('tool-1', 'approval-1')]
    let resolveTrustCheck: ((trusted: boolean) => void) | null = null
    const trustCheckPromise = new Promise<boolean>((resolve) => {
      resolveTrustCheck = resolve
    })

    useAgentChatMock.mockImplementation(() =>
      buildBaseAgentChatReturn({
        messages: currentMessages,
        respondToolApproval,
      }),
    )
    isProjectToolCallTrustedMock.mockReturnValueOnce(trustCheckPromise)

    const { rerender } = renderHook(() => useChatPanelSections())

    await waitFor(() => {
      expect(isProjectToolCallTrustedMock).toHaveBeenCalledWith(
        '/repo',
        'runCommand',
        DEFAULT_TOOL_ARGS,
      )
    })

    currentMessages = [createResolvedApprovalMessage('tool-1', 'approval-1')]
    rerender()

    await act(async () => {
      resolveTrustCheck?.(true)
      await trustCheckPromise
    })

    expect(respondToolApproval).not.toHaveBeenCalled()
  })

  it('keeps pending approval visible when trust resolution returns untrusted', async () => {
    useAgentChatMock.mockReturnValue(
      buildBaseAgentChatReturn({
        messages: [createPendingApprovalMessage('tool-1', 'approval-1')],
      }),
    )
    isProjectToolCallTrustedMock.mockResolvedValueOnce(false)

    const { result } = renderHook(() => useChatPanelSections())

    await waitFor(() => {
      expect(result.current.composer.pendingApproval).toEqual(
        expect.objectContaining({
          approvalId: 'approval-1',
          toolCallId: 'tool-1',
        }),
      )
    })
  })

  it('preserves pending approval visibility after switching away and back', async () => {
    const secondaryConversationId = ConversationId('conv-2')
    const primaryConversation = createConversation()
    const secondaryConversation: Conversation = {
      ...primaryConversation,
      id: secondaryConversationId,
      title: 'Other thread',
      messages: [],
    }
    let activeConversationId: ConversationId = ACTIVE_CONVERSATION_ID
    const createConversationMock = vi.fn()
    const setActiveConversationMock = vi.fn()
    const updateConversationProjectPathMock = vi.fn()
    const agentChatReturn = buildBaseAgentChatReturn()

    useChatMock.mockImplementation(() => ({
      conversations: [primaryConversation, secondaryConversation],
      activeConversation:
        activeConversationId === ACTIVE_CONVERSATION_ID
          ? primaryConversation
          : secondaryConversation,
      activeConversationId,
      createConversation: createConversationMock,
      setActiveConversation: setActiveConversationMock,
      updateConversationProjectPath: updateConversationProjectPathMock,
    }))
    useAgentChatMock.mockImplementation(() => ({
      ...agentChatReturn,
      messages:
        activeConversationId === ACTIVE_CONVERSATION_ID
          ? [createPendingApprovalMessage('tool-1', 'approval-1')]
          : [],
    }))
    isProjectToolCallTrustedMock.mockResolvedValue(false)

    const { result, rerender } = renderHook(() => useChatPanelSections())

    await waitFor(() => {
      expect(result.current.composer.pendingApproval).toEqual(
        expect.objectContaining({
          approvalId: 'approval-1',
          toolCallId: 'tool-1',
        }),
      )
    })
    expect(isProjectToolCallTrustedMock).toHaveBeenCalledTimes(1)

    activeConversationId = secondaryConversationId
    rerender()

    expect(result.current.composer.pendingApproval).toBeNull()

    activeConversationId = ACTIVE_CONVERSATION_ID
    rerender()

    expect(result.current.composer.pendingApproval).toEqual(
      expect.objectContaining({
        approvalId: 'approval-1',
        toolCallId: 'tool-1',
      }),
    )
    expect(isProjectToolCallTrustedMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to visible approval and logs when trust resolution fails', async () => {
    useAgentChatMock.mockReturnValue(
      buildBaseAgentChatReturn({
        messages: [createPendingApprovalMessage('tool-1', 'approval-1')],
      }),
    )
    isProjectToolCallTrustedMock.mockRejectedValueOnce(new Error('trust failed'))

    const { result } = renderHook(() => useChatPanelSections())

    await waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith(
        '[AUTO-APPROVE] Error in trust check or approval',
        expect.objectContaining({
          error: 'trust failed',
        }),
      )
    })
    expect(result.current.composer.pendingApproval).toEqual(
      expect.objectContaining({
        approvalId: 'approval-1',
      }),
    )
  })

  it('marks the composer as loading while a streaming phase is active', () => {
    useStreamingPhaseMock.mockReturnValue({
      current: {
        label: 'Thinking',
        elapsedMs: 1200,
      },
      reset: vi.fn(),
    })

    const { result } = renderHook(() => useChatPanelSections())

    expect(result.current.composer.isLoading).toBe(true)
  })

  describe('lastUserMessageId in transcript state', () => {
    it('is null when there are no messages', () => {
      useAgentChatMock.mockReturnValue(buildBaseAgentChatReturn({ messages: [] }))
      const { result } = renderHook(() => useChatPanelSections())
      expect(result.current.transcript.lastUserMessageId).toBeNull()
    })

    it('returns the id of the last user message', () => {
      useAgentChatMock.mockReturnValue(
        buildBaseAgentChatReturn({
          messages: [
            createUserMessage('user-1', ['first']),
            createUserMessage('user-2', ['second']),
          ],
        }),
      )
      const { result } = renderHook(() => useChatPanelSections())
      expect(result.current.transcript.lastUserMessageId).toBe('user-2')
    })

    it('ignores assistant messages and returns last user id', () => {
      useAgentChatMock.mockReturnValue(
        buildBaseAgentChatReturn({
          messages: [
            createUserMessage('user-1', ['first']),
            {
              id: 'assistant-1',
              role: 'assistant',
              parts: [],
            } as UIMessage,
          ],
        }),
      )
      const { result } = renderHook(() => useChatPanelSections())
      expect(result.current.transcript.lastUserMessageId).toBe('user-1')
    })

    it('resets to null when conversation switches to one with no messages', () => {
      useAgentChatMock.mockReturnValue(buildBaseAgentChatReturn({ messages: [] }))
      const { result } = renderHook(() => useChatPanelSections())
      expect(result.current.transcript.lastUserMessageId).toBeNull()
    })
  })
})
