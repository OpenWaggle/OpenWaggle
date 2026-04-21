import type { UIMessage } from '@tanstack/ai-react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTranscriptSectionState } from '../use-chat-panel-controller'

const REQUEST_ANIMATION_FRAME_DELAY_MS = 16

vi.mock('../ChatRowRenderer', () => ({
  ChatRowRenderer: ({ row }: { row: ChatRow }) => (
    <div>
      {row.type === 'message'
        ? row.message.parts
            .filter(
              (part): part is Extract<(typeof row.message.parts)[number], { type: 'text' }> =>
                part.type === 'text',
            )
            .map((part) => part.content)
            .join('')
        : 'row-content'}
    </div>
  ),
}))

vi.mock('../WelcomeScreen', () => ({
  WelcomeScreen: () => <div>welcome</div>,
}))

vi.mock('@/lib/cn', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}))

import { ChatTranscript } from '../ChatTranscript'
import type { ChatRow } from '../types-chat-row'

function createTextMessage(id: string, role: UIMessage['role'], content: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', content }],
  }
}

function createMessageChatRow(message: UIMessage): ChatRow {
  return {
    type: 'message',
    message,
    isStreaming: false,
    isRunActive: false,
    showTurnDivider: false,
  }
}

function createSection(
  overrides: Partial<ChatTranscriptSectionState> = {},
): ChatTranscriptSectionState {
  const defaultMessage = createTextMessage('msg-1', 'user', 'hello')

  return {
    messages: [defaultMessage],
    isLoading: false,
    projectPath: '/repo',
    recentProjects: [],
    activeConversationId: null,
    chatRows: [createMessageChatRow(defaultMessage)],
    lastUserMessageId: 'msg-1',
    compactedMessageIds: new Set(),
    userDidSend: false,
    onUserDidSendConsumed: vi.fn(),
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

function configureScrollableElement(scroller: HTMLElement): {
  setNaturalScrollHeight: (height: number) => void
  getScrollTop: () => number
} {
  const clientHeight = 500
  let naturalScrollHeight = 1000
  let scrollTop = 500

  function getMaxScrollTop(): number {
    return Math.max(0, naturalScrollHeight - clientHeight)
  }

  function setClampedScrollTop(value: number): void {
    scrollTop = Math.min(Math.max(0, value), getMaxScrollTop())
  }

  Object.defineProperty(scroller, 'scrollHeight', {
    get: () => naturalScrollHeight,
    configurable: true,
  })
  Object.defineProperty(scroller, 'clientHeight', {
    get: () => clientHeight,
    configurable: true,
  })
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: setClampedScrollTop,
    configurable: true,
  })
  Object.defineProperty(scroller, 'scrollTo', {
    value: (options?: ScrollToOptions | number, y?: number) => {
      if (typeof options === 'number') {
        setClampedScrollTop(y ?? 0)
        return
      }
      setClampedScrollTop(options?.top ?? 0)
    },
    configurable: true,
  })

  return {
    setNaturalScrollHeight: (height) => {
      naturalScrollHeight = height
    },
    getScrollTop: () => scrollTop,
  }
}

describe('ChatTranscript t3-style scroll behavior', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    )

    // jsdom does not implement scrollTo — stub it so the scroll hook doesn't crash
    if (!Element.prototype.scrollTo) {
      Element.prototype.scrollTo = vi.fn()
    }

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

  it('keeps a single non-overflowing row at the top', async () => {
    const { container } = render(
      <ChatTranscript
        section={createSection({
          lastUserMessageId: 'msg-1',
          chatRows: [createMessageChatRow(createTextMessage('msg-1', 'user', 'hello'))],
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
          chatRows: [createMessageChatRow(createTextMessage('msg-1', 'user', 'hello'))],
        })}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
    })

    const userEl = container.querySelector('[data-user-message-id="msg-1"]')
    expect(userEl).not.toBeNull()
  })

  it('follows streaming text growth when the message count stays stable', async () => {
    const userMessage = createTextMessage('msg-1', 'user', 'hello')
    const assistantMessage = createTextMessage('msg-2', 'assistant', 'short')
    const { container, rerender } = render(
      <ChatTranscript
        section={createSection({
          isLoading: true,
          messages: [userMessage, assistantMessage],
          chatRows: [createMessageChatRow(userMessage), createMessageChatRow(assistantMessage)],
          lastUserMessageId: 'msg-1',
        })}
      />,
    )

    const scroller = container.querySelector('[role="log"]')
    if (!(scroller instanceof HTMLElement)) {
      throw new Error('Chat scroller not found')
    }
    const layout = configureScrollableElement(scroller)

    const updatedAssistantMessage = createTextMessage('msg-2', 'assistant', 'short '.repeat(60))
    layout.setNaturalScrollHeight(1200)
    rerender(
      <ChatTranscript
        section={createSection({
          isLoading: true,
          messages: [userMessage, updatedAssistantMessage],
          chatRows: [
            createMessageChatRow(userMessage),
            createMessageChatRow(updatedAssistantMessage),
          ],
          lastUserMessageId: 'msg-1',
        })}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
    })

    expect(layout.getScrollTop()).toBe(700)
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
