import type { UIMessage } from '@shared/types/chat-ui'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTranscriptSectionState } from '../../model'

const PROJECT_PATH = '/repo'
const CLIENT_HEIGHT = 500
const ROW_KEY_ATTRIBUTE = 'data-transcript-row-key'

const apiMock = vi.hoisted(() => ({
  registerExtensionFrame: vi.fn(() => Promise.resolve({ frameUrl: '', registrationId: '' })),
  unregisterExtensionFrame: vi.fn(() => Promise.resolve(undefined)),
}))

vi.mock('../ChatRowRenderer', () => ({
  ChatRowRenderer: () => <div />,
}))

vi.mock('../WelcomeScreen', () => ({
  WelcomeScreen: () => <div>welcome</div>,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

import type { MessageChatRow } from '../../lib/types-chat-row'
import { ChatTranscript } from '../ChatTranscript'

/**
 * Block layout for the transcript in jsdom: rows stack in DOM order with known heights, the end
 * space takes its inline height, and the scroller clamps `scrollTop` like a browser does.
 */
function installLayout() {
  const heights = new Map<string, number>()
  let scrollTop = 0

  const scroller = () => document.querySelector<HTMLElement>('[role="log"]')
  const endSpace = () => document.querySelector<HTMLElement>('[data-transcript-end-space]')
  const rowElements = () =>
    Array.from(document.querySelectorAll<HTMLElement>(`[${ROW_KEY_ATTRIBUTE}]`))
  const rowHeight = (element: HTMLElement) =>
    heights.get(element.getAttribute(ROW_KEY_ATTRIBUTE) ?? '') ?? 100
  const endSpaceHeight = () => Number.parseFloat(endSpace()?.style.height ?? '') || 0
  const scrollHeight = () =>
    rowElements().reduce((sum, element) => sum + rowHeight(element), 0) + endSpaceHeight()
  const maxScrollTop = () => Math.max(0, scrollHeight() - CLIENT_HEIGHT)
  const clamp = (value: number) => Math.min(Math.max(0, value), maxScrollTop())
  const rect = (top: number, height: number) => new DOMRect(0, top, 800, height)

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this === scroller()) return rect(0, CLIENT_HEIGHT)
    if (this.hasAttribute(ROW_KEY_ATTRIBUTE)) {
      let offset = 0
      for (const element of rowElements()) {
        if (element === this) return rect(offset - scrollTop, rowHeight(element))
        offset += rowHeight(element)
      }
    }
    return rect(0, 0)
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this === scroller() ? scrollHeight() : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this === scroller() ? CLIENT_HEIGHT : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this === endSpace() ? endSpaceHeight() : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      return this === scroller() ? scrollTop : 0
    },
    set(this: HTMLElement, value: number) {
      if (this === scroller()) scrollTop = clamp(value)
    },
  })

  return {
    setHeight: (key: string, height: number) => heights.set(key, height),
    rowTop: (key: string) => {
      let offset = 0
      for (const element of rowElements()) {
        if (element.getAttribute(ROW_KEY_ATTRIBUTE) === key) return offset - scrollTop
        offset += rowHeight(element)
      }
      return null
    },
    mode: () => scroller()?.dataset.transcriptMode,
    distanceToBottom: () => maxScrollTop() - scrollTop,
    /** A reader scrolling to this offset, which the transcript did not cause. */
    userScrollTo: (value: number) => {
      scrollTop = clamp(value)
      scroller()?.dispatchEvent(new Event('scroll'))
    },
    get scrollTop() {
      return scrollTop
    },
  }
}

function userMessage(id: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', content: id }] }
}

function assistantMessage(id: string, withToolCall: boolean): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      { type: 'text', content: 'Looking' },
      ...(withToolCall
        ? [
            {
              type: 'tool-call' as const,
              id: `${id}-tool`,
              name: 'read',
              arguments: '{}',
              state: 'input-available',
            },
          ]
        : []),
    ],
  }
}

function row(message: UIMessage): MessageChatRow {
  return { type: 'message', message, isStreaming: false, isRunActive: true, showTurnDivider: false }
}

function section(
  messages: readonly UIMessage[],
  overrides: Partial<ChatTranscriptSectionState> = {},
): ChatTranscriptSectionState {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  return {
    messages: [...messages],
    isLoading: true,
    projectPath: PROJECT_PATH,
    worktreePath: null,
    recentProjects: [],
    activeSessionId: null,
    turnsByAnchorNodeId: new Map(),
    onToggleTurnFold: () => {},
    onDismissInterruptedRun: () => {},
    chatRows: messages.map(row),
    extensionRegistry: null,
    extensionProjectPaths: [],
    lastUserMessageId: lastUser?.id ?? null,
    streamSignalVersion: 0,
    userDidSend: false,
    onUserDidSendConsumed: vi.fn(),
    onOpenProject: vi.fn().mockResolvedValue(undefined),
    onSelectProjectPath: vi.fn(),
    onRetryText: vi.fn().mockResolvedValue(undefined),
    onOpenSettings: vi.fn(),
    onDismissError: vi.fn(),
    onBranchFromMessage: vi.fn(),
    onForkFromMessage: vi.fn(),
    onViewTurnDiff: vi.fn(),
    turnAnchorMessageIds: new Set<string>(),
    ...overrides,
  }
}

const history = [userMessage('u1'), assistantMessage('a1', false)]

describe('ChatTranscript sent turn', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    for (const property of ['scrollHeight', 'clientHeight', 'offsetHeight', 'scrollTop']) {
      Reflect.deleteProperty(HTMLElement.prototype, property)
    }
  })

  function sendTurn() {
    const layout = installLayout()
    layout.setHeight('message:a1', 900)
    layout.setHeight('message:u2', 60)
    const view = render(<ChatTranscript section={section(history, { isLoading: false })} />)
    const sent = [...history, userMessage('u2')]
    view.rerender(<ChatTranscript section={section(sent, { userDidSend: true })} />)
    return { layout, view, sent }
  }

  it('pins the sent message near the top while its reply streams', () => {
    const { layout, view, sent } = sendTurn()
    expect(layout.mode()).toBe('new-turn:message:u2')
    expect(layout.rowTop('message:u2')).toBe(24)

    layout.setHeight('message:a2', 120)
    view.rerender(<ChatTranscript section={section([...sent, assistantMessage('a2', false)])} />)
    expect(layout.rowTop('message:u2')).toBe(24)
  })

  it('keeps the sent message pinned when the reply starts using tools', () => {
    const { layout, view, sent } = sendTurn()

    layout.setHeight('message:a2', 120)
    view.rerender(<ChatTranscript section={section([...sent, assistantMessage('a2', true)])} />)

    expect(layout.mode()).toBe('new-turn:message:u2')
    expect(layout.rowTop('message:u2')).toBe(24)
  })

  it('holds the view still once the reply outgrows the viewport instead of following it', () => {
    const { layout, view, sent } = sendTurn()

    layout.setHeight('message:a2', 1400)
    view.rerender(<ChatTranscript section={section([...sent, assistantMessage('a2', true)])} />)

    expect(layout.rowTop('message:u2')).toBe(24)
    expect(layout.distanceToBottom()).toBeGreaterThan(0)
    expect(document.querySelector('[aria-label="Scroll to bottom"]')).not.toBeNull()

    layout.setHeight('message:a2', 2000)
    view.rerender(<ChatTranscript section={section([...sent, assistantMessage('a2', true)])} />)
    expect(layout.rowTop('message:u2')).toBe(24)
  })

  it('rejoins the live end when the reader scrolls down to it', () => {
    const { layout, view, sent } = sendTurn()
    layout.setHeight('message:a2', 1400)
    const streaming = [...sent, assistantMessage('a2', true)]
    view.rerender(<ChatTranscript section={section(streaming)} />)

    act(() => layout.userScrollTo(layout.scrollTop + layout.distanceToBottom()))
    expect(layout.mode()).toBe('following')

    layout.setHeight('message:a2', 1600)
    view.rerender(<ChatTranscript section={section(streaming)} />)
    expect(layout.distanceToBottom()).toBe(0)
  })

  it('does not drop the reserved space under a reader who scrolls up during the reply', () => {
    const { layout, view, sent } = sendTurn()
    layout.setHeight('message:a2', 120)
    const streaming = [...sent, assistantMessage('a2', false)]
    view.rerender(<ChatTranscript section={section(streaming)} />)

    act(() => layout.userScrollTo(layout.scrollTop - 200))
    expect(layout.rowTop('message:u2')).toBe(224)
    expect(layout.mode()).not.toBe('following')

    layout.setHeight('message:a2', 200)
    view.rerender(<ChatTranscript section={section(streaming)} />)
    expect(layout.rowTop('message:u2')).toBe(224)
  })
})
