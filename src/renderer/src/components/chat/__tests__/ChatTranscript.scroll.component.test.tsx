import type { UIMessage } from '@tanstack/ai-react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTranscriptSectionState } from '../use-chat-panel-controller'

const REQUEST_ANIMATION_FRAME_DELAY_MS = 16

vi.mock('../ChatRowRenderer', () => ({
  ChatRowRenderer: () => <div>row-content</div>,
}))

vi.mock('../WelcomeScreen', () => ({
  WelcomeScreen: () => <div>welcome</div>,
}))

vi.mock('@/lib/cn', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}))

import { ChatTranscript } from '../ChatTranscript'
import type { ChatRow } from '../types-chat-row'

function createUserChatRow(messageId: string): ChatRow {
  return {
    type: 'message',
    message: {
      id: messageId,
      role: 'user',
      parts: [{ type: 'text' as const, text: 'hello', content: 'hello' }],
    } as UIMessage,
    isStreaming: false,
    showTurnDivider: false,
  }
}

function createSection(
  overrides: Partial<ChatTranscriptSectionState> = {},
): ChatTranscriptSectionState {
  return {
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        parts: [{ type: 'text' as const, text: 'hello', content: 'hello' }],
      } as UIMessage,
    ],
    isLoading: false,
    projectPath: '/repo',
    recentProjects: [],
    activeConversationId: null,
    chatRows: [createUserChatRow('msg-1')],
    lastUserMessageId: 'msg-1',
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

describe('ChatTranscript scroll-to-user-message effect (Voyager pattern)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    )

    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) =>
      window.setTimeout(() => callback(performance.now()), REQUEST_ANIMATION_FRAME_DELAY_MS),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
      window.clearTimeout(handle)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('does not scroll when there is only one row (first message, nothing to scroll past)', async () => {
    // Single user message — chatRows.length === 1, so scroll is skipped
    const { container } = render(
      <ChatTranscript
        section={createSection({
          lastUserMessageId: 'msg-1',
          chatRows: [createUserChatRow('msg-1')],
        })}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
    })

    const scroller = container.querySelector('[role="log"]')
    expect(scroller).not.toBeNull()
    expect((scroller as HTMLElement).scrollTop).toBe(0)
  })

  it('data-user-message-id attribute is present on user message rows', async () => {
    // Single user row renders with the attribute
    const { container } = render(
      <ChatTranscript
        section={createSection({
          lastUserMessageId: 'msg-1',
          chatRows: [createUserChatRow('msg-1')],
        })}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
    })

    const userEl = container.querySelector('[data-user-message-id="msg-1"]')
    expect(userEl).not.toBeNull()
  })

  it('[overflow-anchor:none] class is on the scroll container', () => {
    const { container } = render(<ChatTranscript section={createSection()} />)
    const scroller = container.querySelector('[role="log"]')
    expect(scroller?.className).toContain('[overflow-anchor:none]')
  })

  it('does not scroll when lastUserMessageId is null', async () => {
    const { container } = render(
      <ChatTranscript
        section={createSection({
          lastUserMessageId: null,
          messages: [],
          chatRows: [],
        })}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
    })

    // With no messages and not loading, the welcome screen renders
    const scroller = container.querySelector('[role="log"]')
    expect(scroller).toBeNull()
  })
})
