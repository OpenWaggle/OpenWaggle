import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTranscriptSectionState } from '../../model'

const REQUEST_ANIMATION_FRAME_DELAY_MS = 16
const PROJECT_PATH = '/repo'

vi.mock('../ChatRowRenderer', () => ({
  ChatRowRenderer: ({ row }: { row: ChatRow }) => (
    <div>
      {row.type === 'message'
        ? row.message.parts.reduce(
            (text, part) => (part.type === 'text' ? `${text}${part.content}` : text),
            '',
          )
        : 'row-content'}
    </div>
  ),
}))

vi.mock('../WelcomeScreen', () => ({
  WelcomeScreen: () => <div>welcome</div>,
}))

vi.mock('@/shared/lib/cn', () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}))

import type { ChatRow } from '../../lib/types-chat-row'
import { ChatTranscript } from '../ChatTranscript'

function createTextMessage(id: string, role: UIMessage['role'], content: string) {
  return {
    id,
    role,
    parts: [{ type: 'text', content }],
  }
}

function createMessageChatRow(message: UIMessage) {
  return {
    type: 'message',
    message,
    isStreaming: false,
    isRunActive: false,
    showTurnDivider: false,
  }
}

function transcriptRendererEntry(): ExtensionContributionRegistryEntry {
  return {
    extensionId: 'transcript-extension',
    extensionName: 'Transcript Extension',
    extensionVersion: '1.0.0',
    scope: {
      kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
      label: 'Project',
      projectPath: PROJECT_PATH,
    },
    packagePath: `${PROJECT_PATH}/.openwaggle/extensions/transcript-extension`,
    manifestPath: `${PROJECT_PATH}/.openwaggle/extensions/transcript-extension/openwaggle.extension.json`,
    contentHash: 'abcdef',
    projectPaths: [PROJECT_PATH],
    appliesToAllRequestedProjects: true,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TRANSCRIPT_RENDERERS,
    contributionId: 'transcript-extension.card',
    title: 'Transcript Extension Card',
    label: 'Transcript Extension Card',
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: 'dist/transcript.js',
    matches: {},
    eligibility: {
      runtimeEnabled: true,
      enabled: true,
      trusted: true,
      sdkCompatible: true,
      updateAvailable: false,
      disabledProjectPaths: [],
    },
    diagnostics: [],
  }
}

function transcriptRendererRegistry(): ExtensionContributionRegistryView {
  return {
    projectPaths: [PROJECT_PATH],
    entries: [transcriptRendererEntry()],
  }
}

function createSection(overrides: Partial<ChatTranscriptSectionState> = {}) {
  const defaultMessage = createTextMessage('msg-1', 'user', 'hello')

  return {
    messages: [defaultMessage],
    isLoading: false,
    projectPath: PROJECT_PATH,
    recentProjects: [],
    activeSessionId: null,
    chatRows: [createMessageChatRow(defaultMessage)],
    extensionRegistry: null,
    extensionProjectPaths: [],
    lastUserMessageId: 'msg-1',
    streamSignalVersion: 0,
    userDidSend: false,
    onUserDidSendConsumed: vi.fn(),
    onOpenProject: vi.fn().mockResolvedValue(undefined),
    onSelectProjectPath: vi.fn(),
    onRetryText: vi.fn().mockResolvedValue(undefined),
    onOpenSettings: vi.fn(),
    onDismissError: vi.fn(),
    onDismissInterruptedRun: vi.fn(),
    onBranchFromMessage: vi.fn(),
    onForkFromMessage: vi.fn(),
    ...overrides,
  }
}

function configureScrollableElement(scroller: HTMLElement) {
  const clientHeight = 500
  let naturalScrollHeight = 1000
  let scrollTop = 500

  function getMaxScrollTop() {
    return Math.max(0, naturalScrollHeight - clientHeight)
  }

  function setClampedScrollTop(value: number) {
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
        observe() {}
        unobserve() {}
        disconnect() {}
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
    expect(scroller).toBeInstanceOf(HTMLElement)
    if (!(scroller instanceof HTMLElement)) {
      throw new Error('Expected transcript scroller')
    }
    expect(scroller.scrollTop).toBe(0)
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

  it('mounts transcript renderer contributions in the production transcript surface', async () => {
    render(
      <ChatTranscript
        section={createSection({
          activeSessionId: SessionId('session-1'),
          extensionRegistry: transcriptRendererRegistry(),
          extensionProjectPaths: [PROJECT_PATH],
        })}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_ANIMATION_FRAME_DELAY_MS)
    })

    expect(screen.getByText('Transcript Extension Card')).toBeInTheDocument()
    expect(screen.queryByText('Transcript renderer')).not.toBeInTheDocument()
    expect(screen.queryByText('transcriptRenderers')).not.toBeInTheDocument()

    const frame = screen.getByTitle('Extension module: Transcript Extension Card')
    expect(frame).toHaveAttribute('src', expect.stringContaining('blob:'))
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
