import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ChatRowRenderer', () => ({
  ChatRowRenderer: () => <div />,
}))

vi.mock('../WelcomeScreen', () => ({
  WelcomeScreen: () => <div>welcome</div>,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    registerExtensionFrame: vi.fn(() => Promise.resolve({ frameUrl: '', registrationId: '' })),
    unregisterExtensionFrame: vi.fn(() => Promise.resolve(undefined)),
  },
}))

import type { UIMessage } from '@shared/types/chat-ui'
import type { ChatTranscriptSectionState } from '../../model'
import { ChatTranscript } from '../ChatTranscript'
import {
  assistantMessage,
  installLayout,
  messageRow,
  transcriptSection as section,
  turnFoldRow,
  userMessage,
} from './transcript-layout.test-harness'

const ROW_KEY_ATTRIBUTE = 'data-transcript-row-key'
const HISTORY_TURNS = 60
const STREAMED_COMMITS = 20
const LIVE_END_SCROLL_PX = 1_000_000

function history(): UIMessage[] {
  return Array.from({ length: HISTORY_TURNS }, (_, index) => [
    userMessage(`u${String(index)}`),
    assistantMessage(`a${String(index)}`, false),
  ]).flat()
}

/**
 * The settle presentation reads which rows the reader can see (ADR 0036). It used to measure
 * every mounted row on every commit, which was about a quarter of the streaming JavaScript (B3).
 */
describe('ChatTranscript settle measurement', () => {
  let layout: ReturnType<typeof installLayout>

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
    layout = installLayout()
  })

  afterEach(() => {
    layout.restore()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function rowMeasurements() {
    const spy = vi.mocked(HTMLElement.prototype.getBoundingClientRect)
    return spy.mock.contexts.filter(
      (element) => element instanceof HTMLElement && element.hasAttribute(ROW_KEY_ATTRIBUTE),
    ).length
  }

  function streamTurn(onToggleTurnFold = vi.fn()) {
    const turn = [...history(), userMessage('live')]
    const work = assistantMessage('work', true)
    const answer = assistantMessage('answer', false)
    const streaming = [...turn, work, answer]
    const view = render(
      <ChatTranscript section={section(streaming, { onToggleTurnFold, isLoading: true })} />,
    )
    const commit = (state: ChatTranscriptSectionState) => {
      view.rerender(<ChatTranscript section={state} />)
      act(() => layout.flushScroll())
    }
    // The reader starts at the live end of the streaming turn.
    act(() => layout.userScroll(LIVE_END_SCROLL_PX))
    commit(section([...streaming], { onToggleTurnFold, isLoading: true }))
    const settle = () =>
      commit(
        section([...turn, answer], {
          isLoading: false,
          onToggleTurnFold,
          chatRows: [...turn.map(messageRow), turnFoldRow('live'), messageRow(answer)],
        }),
      )
    return { streaming, commit, settle, onToggleTurnFold }
  }

  it('does not measure the mounted rows on every streamed commit while following', () => {
    const { streaming, commit } = streamTurn()
    expect(layout.mode()).toBe('following')
    expect(layout.distanceToBottom()).toBe(0)
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockClear()

    for (let index = 0; index < STREAMED_COMMITS; index += 1) {
      commit(section([...streaming], { isLoading: true }))
    }

    // Walking every mounted row measured each of them per commit: 20 × 123 rows here.
    expect(rowMeasurements()).toBe(0)
  })

  it('measures a reader scrolled away with a bounded search, not a walk of every row', () => {
    const { streaming, commit } = streamTurn()
    // Just above the live end, where walking from the first row measured nearly all of them.
    act(() => layout.userScroll(-150))
    expect(layout.mode()).toMatch(/^anchored:/u)
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockClear()

    commit(section([...streaming], { isLoading: true }))

    const mounted = document.querySelectorAll(`[${ROW_KEY_ATTRIBUTE}]`).length
    expect(rowMeasurements()).toBeLessThan(mounted / 2)
  })

  it('keeps the settling turn open under a reader scrolled into its work', () => {
    const { streaming, commit, settle, onToggleTurnFold } = streamTurn()
    layout.setHeight('message:answer', 400)
    commit(section([...streaming], { isLoading: true, onToggleTurnFold }))
    // The work row and the start of the answer are in view; the reader stays with them.
    act(() => layout.userScroll(-300))
    commit(section([...streaming], { isLoading: true, onToggleTurnFold }))

    settle()

    expect(onToggleTurnFold).toHaveBeenCalledWith('live')
  })

  it('keeps the turn open for a reader who left the live end after the last token', () => {
    const { streaming, commit, settle, onToggleTurnFold } = streamTurn()
    layout.setHeight('message:answer', 600)
    commit(section([...streaming], { isLoading: true, onToggleTurnFold }))
    // No commit between leaving the live end and the settle: the anchored row stands in.
    act(() => layout.userScroll(-150))
    expect(layout.mode()).toBe('anchored:message:work')

    settle()

    expect(onToggleTurnFold).toHaveBeenCalledWith('live')
  })

  it('folds the settling turn away under a follower', () => {
    const { settle, onToggleTurnFold } = streamTurn()

    settle()

    expect(onToggleTurnFold).not.toHaveBeenCalled()
  })
})
