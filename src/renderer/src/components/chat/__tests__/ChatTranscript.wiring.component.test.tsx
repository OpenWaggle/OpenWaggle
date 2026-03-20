import type { UIMessage } from '@tanstack/ai-react'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatTranscriptSectionState } from '../use-chat-panel-controller'

const useChatScrollBehaviourMock = vi.fn(() => ({
  scrollerRef: { current: null },
  spacerRef: { current: null },
  userMessageRef: { current: null },
  handleScroll: vi.fn(),
}))

vi.mock('../hooks/useChatScrollBehaviour', () => ({
  useChatScrollBehaviour: (
    params: Parameters<typeof useChatScrollBehaviourMock>[0],
  ): ReturnType<typeof useChatScrollBehaviourMock> => useChatScrollBehaviourMock(params),
}))

vi.mock('../ChatRowRenderer', () => ({
  ChatRowRenderer: () => <div>row</div>,
}))

vi.mock('../WelcomeScreen', () => ({
  WelcomeScreen: () => <div>welcome</div>,
}))

import { ChatTranscript } from '../ChatTranscript'

function createSection(
  overrides: Partial<ChatTranscriptSectionState> = {},
): ChatTranscriptSectionState {
  return {
    messages: [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', content: 'hello' }],
      } as UIMessage,
    ],
    isLoading: false,
    disableAutoFollowDuringWaggleStreaming: false,
    projectPath: '/repo',
    recentProjects: [],
    activeConversationId: null,
    chatRows: [
      {
        type: 'message',
        message: {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', content: 'hello' }],
        } as UIMessage,
        isStreaming: false,
        showTurnDivider: false,
      },
    ],
    lastUserMessageId: 'user-1',
    onOpenProject: vi.fn().mockResolvedValue(undefined),
    onSelectProjectPath: vi.fn(),
    onRetryText: vi.fn().mockResolvedValue(undefined),
    onAnswerQuestion: vi.fn().mockResolvedValue(undefined),
    onRespondToPlan: vi.fn().mockResolvedValue(undefined),
    onOpenSettings: vi.fn(),
    onDismissError: vi.fn(),
    ...overrides,
  }
}

describe('ChatTranscript wiring', () => {
  it('passes waggle auto-follow policy flag into useChatScrollBehaviour', () => {
    render(
      <ChatTranscript
        section={createSection({
          disableAutoFollowDuringWaggleStreaming: true,
        })}
      />,
    )

    expect(useChatScrollBehaviourMock).toHaveBeenCalledWith(
      expect.objectContaining({
        disableAutoFollowDuringWaggleStreaming: true,
      }),
    )
  })
})
