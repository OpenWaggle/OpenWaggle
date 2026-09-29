import type { UIMessage } from '@shared/types/chat-ui'
import { vi } from 'vitest'
import type { ChatRow, MessageChatRow } from '../../lib/types-chat-row'
import type { ChatTranscriptSectionState } from '../../model'

export const CLIENT_HEIGHT = 500
const ROW_KEY_ATTRIBUTE = 'data-transcript-row-key'
const OVERRIDDEN = ['scrollHeight', 'clientHeight', 'offsetHeight', 'scrollTop'] as const

/**
 * Block layout for the transcript in jsdom: rows stack in DOM order with known heights, the end
 * space takes its inline height, and the scroller clamps `scrollTop` like a browser does. Like a
 * browser, a write or a clamp queues one `scroll` event, which `flushScroll` delivers.
 *
 * Returns a `restore` that puts jsdom's own property descriptors back.
 */
export function installLayout() {
  const heights = new Map<string, number>()
  let rawScrollTop = 0
  let scrollPending = false

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
  const scrollTop = () => {
    const clamped = Math.min(Math.max(0, rawScrollTop), maxScrollTop())
    if (clamped !== rawScrollTop) {
      rawScrollTop = clamped
      scrollPending = true
    }
    return rawScrollTop
  }
  const rect = (top: number, height: number) => new DOMRect(0, top, 800, height)

  const originals = OVERRIDDEN.map(
    (property) =>
      [property, Object.getOwnPropertyDescriptor(HTMLElement.prototype, property)] as const,
  )
  const boundingRect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      if (this === scroller()) return rect(0, CLIENT_HEIGHT)
      if (this.hasAttribute(ROW_KEY_ATTRIBUTE)) {
        let offset = 0
        for (const element of rowElements()) {
          if (element === this) return rect(offset - scrollTop(), rowHeight(element))
          offset += rowHeight(element)
        }
      }
      return rect(0, 0)
    })
  function define(property: (typeof OVERRIDDEN)[number], descriptor: PropertyDescriptor) {
    Object.defineProperty(HTMLElement.prototype, property, { configurable: true, ...descriptor })
  }
  define('scrollHeight', {
    get(this: HTMLElement) {
      return this === scroller() ? scrollHeight() : 0
    },
  })
  define('clientHeight', {
    get(this: HTMLElement) {
      return this === scroller() ? CLIENT_HEIGHT : 0
    },
  })
  define('offsetHeight', {
    get(this: HTMLElement) {
      return this === endSpace() ? endSpaceHeight() : 0
    },
  })
  define('scrollTop', {
    get(this: HTMLElement) {
      return this === scroller() ? scrollTop() : 0
    },
    set(this: HTMLElement, value: number) {
      if (this !== scroller()) return
      const previous = scrollTop()
      rawScrollTop = value
      if (scrollTop() !== previous) scrollPending = true
    },
  })

  function rowTop(key: string) {
    let offset = 0
    for (const element of rowElements()) {
      if (element.getAttribute(ROW_KEY_ATTRIBUTE) === key) return offset - scrollTop()
      offset += rowHeight(element)
    }
    return null
  }

  return {
    setHeight: (key: string, height: number) => heights.set(key, height),
    rowTop,
    mode: () => scroller()?.dataset.transcriptMode,
    distanceToBottom: () => maxScrollTop() - scrollTop(),
    get scrollTop() {
      return scrollTop()
    },
    /** Delivers the scroll event a browser fires after a write or a clamp. */
    flushScroll: () => {
      scrollTop()
      if (!scrollPending) return
      scrollPending = false
      scroller()?.dispatchEvent(new Event('scroll'))
    },
    /** A reader scrolling by this delta, with the wheel intent a browser reports first. */
    userScroll: (delta: number) => {
      scroller()?.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true }))
      rawScrollTop = scrollTop() + delta
      scrollTop()
      scrollPending = false
      scroller()?.dispatchEvent(new Event('scroll'))
    },
    restore: () => {
      boundingRect.mockRestore()
      for (const [property, descriptor] of originals) {
        if (descriptor) Object.defineProperty(HTMLElement.prototype, property, descriptor)
        else Reflect.deleteProperty(HTMLElement.prototype, property)
      }
    },
  }
}

export function userMessage(id: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', content: id }] }
}

export function assistantMessage(id: string, withToolCall: boolean): UIMessage {
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

export function messageRow(message: UIMessage): MessageChatRow {
  return { type: 'message', message, isStreaming: false, isRunActive: true, showTurnDivider: false }
}

export function turnFoldRow(turnKey: string): ChatRow {
  return {
    type: 'turn-fold',
    id: `turn-fold:${turnKey}`,
    turnKey,
    label: 'Worked',
    durationMs: null,
    interrupted: false,
  }
}

export function transcriptSection(
  messages: readonly UIMessage[],
  overrides: Partial<ChatTranscriptSectionState> = {},
): ChatTranscriptSectionState {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  return {
    messages: [...messages],
    isLoading: true,
    projectPath: '/repo',
    worktreePath: null,
    recentProjects: [],
    activeSessionId: null,
    turnsByAnchorNodeId: new Map(),
    onToggleTurnFold: () => {},
    onDismissInterruptedRun: () => {},
    chatRows: messages.map(messageRow),
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
