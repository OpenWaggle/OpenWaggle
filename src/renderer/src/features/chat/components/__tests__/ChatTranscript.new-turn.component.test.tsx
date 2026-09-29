import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const history = [userMessage('u1'), assistantMessage('a1', false)]

/**
 * A sent message is held near the top until its turn reaches the bottom of the viewport (ADR 0036).
 * These drive the real transcript hooks; the scroll rules themselves are unit-tested in the
 * controller.
 */
describe('ChatTranscript sent turn', () => {
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

  function sendTurn() {
    layout.setHeight('message:a1', 900)
    layout.setHeight('message:u2', 60)
    const view = render(<ChatTranscript section={section(history, { isLoading: false })} />)
    const sent = [...history, userMessage('u2')]
    view.rerender(<ChatTranscript section={section(sent, { userDidSend: true })} />)
    act(() => layout.flushScroll())
    const commit = (state: ChatTranscriptSectionState) => {
      view.rerender(<ChatTranscript section={state} />)
      act(() => layout.flushScroll())
    }
    return { view, sent, commit }
  }

  it('pins the sent message near the top while its reply streams', () => {
    const { sent, commit } = sendTurn()
    expect(layout.mode()).toBe('new-turn:message:u2')
    expect(layout.rowTop('message:u2')).toBe(24)

    layout.setHeight('message:a2', 120)
    commit(section([...sent, assistantMessage('a2', false)]))
    expect(layout.rowTop('message:u2')).toBe(24)
  })

  it('keeps the sent message pinned when the reply starts using tools', () => {
    const { sent, commit } = sendTurn()

    layout.setHeight('message:a2', 120)
    commit(section([...sent, assistantMessage('a2', true)]))

    expect(layout.mode()).toBe('new-turn:message:u2')
    expect(layout.rowTop('message:u2')).toBe(24)
  })

  it('follows a working turn from the moment it reaches the bottom of the viewport', () => {
    const { sent, commit } = sendTurn()
    layout.setHeight('message:a2', 400)
    commit(section([...sent, assistantMessage('a2', true)]))
    expect(layout.rowTop('message:u2')).toBe(24)

    layout.setHeight('message:a2', 1400)
    commit(section([...sent, assistantMessage('a2', true)]))

    expect(layout.mode()).toBe('following')
    expect(layout.distanceToBottom()).toBe(0)
    // The view moved toward the end, never down the screen.
    expect(layout.rowTop('message:u2')).toBeLessThan(24)
  })

  it('holds a plain answer still once it outgrows the viewport', () => {
    const { sent, commit } = sendTurn()

    layout.setHeight('message:a2', 1400)
    commit(section([...sent, assistantMessage('a2', false)]))
    expect(layout.rowTop('message:u2')).toBe(24)
    expect(layout.distanceToBottom()).toBeGreaterThan(0)
    const button = document.querySelector('[aria-label="Scroll to bottom"]')
    expect(button?.getAttribute('data-working')).toBe('true')

    layout.setHeight('message:a2', 2000)
    commit(section([...sent, assistantMessage('a2', false)]))
    expect(layout.rowTop('message:u2')).toBe(24)
  })

  it('rejoins the live end when the reader scrolls down to it', () => {
    const { sent, commit } = sendTurn()
    layout.setHeight('message:a2', 1400)
    const streaming = [...sent, assistantMessage('a2', false)]
    commit(section(streaming))

    act(() => layout.userScroll(layout.distanceToBottom()))
    expect(layout.mode()).toBe('following')

    layout.setHeight('message:a2', 1600)
    commit(section(streaming))
    expect(layout.distanceToBottom()).toBe(0)
  })

  it('does not drop the reserved space under a reader who scrolls up during the reply', () => {
    const { sent, commit } = sendTurn()
    layout.setHeight('message:a2', 120)
    const streaming = [...sent, assistantMessage('a2', false)]
    commit(section(streaming))

    act(() => layout.userScroll(-200))
    expect(layout.rowTop('message:u2')).toBe(224)
    expect(layout.mode()).not.toBe('following')

    layout.setHeight('message:a2', 200)
    commit(section(streaming))
    expect(layout.rowTop('message:u2')).toBe(224)
  })

  it('keeps holding the sent message when its optimistic copy is persisted under a new id', () => {
    const { sent, commit } = sendTurn()
    layout.setHeight('message:a2', 120)
    layout.setHeight('message:u2-persisted', 60)
    commit(section([...sent, assistantMessage('a2', false)]))

    commit(section([...history, userMessage('u2-persisted'), assistantMessage('a2', false)]))

    expect(layout.mode()).toBe('new-turn:message:u2-persisted')
    expect(layout.rowTop('message:u2-persisted')).toBe(24)
  })

  it('keeps the reserved space under a scrolled reader when the sent copy is persisted', () => {
    const { sent, commit } = sendTurn()
    layout.setHeight('message:a2', 120)
    layout.setHeight('message:u2-persisted', 60)
    commit(section([...sent, assistantMessage('a2', false)]))
    act(() => layout.userScroll(-200))

    commit(section([...history, userMessage('u2-persisted'), assistantMessage('a2', false)]))

    expect(layout.rowTop('message:u2-persisted')).toBe(224)
  })

  it('folds a settled turn away below a held message instead of reopening it', () => {
    const { sent, commit } = sendTurn()
    const onToggleTurnFold = vi.fn()
    const work = assistantMessage('work', true)
    const answer = assistantMessage('answer', false)
    layout.setHeight('message:work', 200)
    commit(section([...sent, work, answer], { onToggleTurnFold }))
    expect(layout.rowTop('message:u2')).toBe(24)

    const settled = [...sent, answer]
    const settledRows = [...sent.map(messageRow), turnFoldRow('u2'), messageRow(answer)]
    commit(section(settled, { isLoading: false, chatRows: settledRows, onToggleTurnFold }))

    expect(onToggleTurnFold).not.toHaveBeenCalled()
    expect(layout.rowTop('message:u2')).toBe(24)
  })

  it('mounts the reply under a message sent from a full live window', () => {
    // A follower's window grows to its 160-row bound as rows arrive, so the sent row is its last.
    const older = Array.from({ length: 170 }, (_, index) => userMessage(`h${String(index)}`))
    const view = render(
      <ChatTranscript section={section(older.slice(0, 40), { isLoading: false })} />,
    )
    view.rerender(<ChatTranscript section={section(older, { isLoading: false })} />)
    const sent = [...older, userMessage('u2')]
    view.rerender(<ChatTranscript section={section(sent, { userDidSend: true })} />)
    view.rerender(<ChatTranscript section={section([...sent, assistantMessage('a2', false)])} />)

    expect(layout.rowTop('message:a2')).not.toBeNull()
    expect(document.body.textContent).not.toContain('Load newer messages')
    expect(layout.mode()).toBe('new-turn:message:u2')
  })
})
