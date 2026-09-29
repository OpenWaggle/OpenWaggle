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

import { pendingSendAfter } from '../../lib/optimistic-user-message'
import type { ChatTranscriptSectionState } from '../../model'
import { ChatTranscript } from '../ChatTranscript'
import {
  assistantMessage,
  installLayout,
  transcriptSection as section,
  userMessage,
} from './transcript-layout.test-harness'

const history = [userMessage('u1'), assistantMessage('a1', false)]

/**
 * Which row a send holds (ADR 0036): the send's own optimistic message, whatever order the send,
 * its row, a remount, or a persisted earlier message arrive in.
 */
describe('ChatTranscript sent turn identity', () => {
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
    layout.setHeight('message:optimistic-user-2', 60)
    const view = render(<ChatTranscript section={section(history, { isLoading: false })} />)
    const sent = [...history, userMessage('optimistic-user-2')]
    view.rerender(
      <ChatTranscript section={section(sent, { pendingSend: pendingSendAfter(history) })} />,
    )
    act(() => layout.flushScroll())
    const commit = (state: ChatTranscriptSectionState) => {
      view.rerender(<ChatTranscript section={state} />)
      act(() => layout.flushScroll())
    }
    return { view, sent, commit }
  }

  it('holds the sent message, not the previous one, when the send commits before its row', () => {
    layout.setHeight('message:a1', 900)
    layout.setHeight('message:optimistic-user-2', 60)
    const view = render(<ChatTranscript section={section(history, { isLoading: false })} />)
    view.rerender(
      <ChatTranscript section={section(history, { pendingSend: pendingSendAfter(history) })} />,
    )
    expect(layout.mode()).toBe('following')

    view.rerender(
      <ChatTranscript
        section={section([...history, userMessage('optimistic-user-2')], {
          pendingSend: pendingSendAfter(history),
        })}
      />,
    )
    expect(layout.mode()).toBe('new-turn:message:optimistic-user-2')
    expect(layout.rowTop('message:optimistic-user-2')).toBe(24)
  })

  it('holds the first message of a new Session whose view mounts with it already present', () => {
    layout.setHeight('message:optimistic-user-1', 60)
    const onPendingSendConsumed = vi.fn()
    const first = [userMessage('optimistic-user-1')]
    render(
      <ChatTranscript
        section={section(first, { pendingSend: pendingSendAfter([]), onPendingSendConsumed })}
      />,
    )

    expect(layout.mode()).toBe('new-turn:message:optimistic-user-1')
    expect(onPendingSendConsumed).toHaveBeenCalled()
  })

  it('does not take the previous message being persisted for a pending send', () => {
    layout.setHeight('message:a1', 900)
    const onPendingSendConsumed = vi.fn()
    const view = render(<ChatTranscript section={section(history, { isLoading: false })} />)
    view.rerender(
      <ChatTranscript
        section={section(history, {
          pendingSend: pendingSendAfter(history),
          onPendingSendConsumed,
        })}
      />,
    )
    const persisted = [userMessage('u1-persisted'), assistantMessage('a1', false)]
    view.rerender(
      <ChatTranscript
        section={section(persisted, {
          pendingSend: pendingSendAfter(history),
          onPendingSendConsumed,
        })}
      />,
    )

    expect(layout.mode()).toBe('following')
    expect(onPendingSendConsumed).not.toHaveBeenCalled()
  })

  it('does not hold an optimistic message when nothing is being sent', () => {
    layout.setHeight('message:a1', 900)
    const earlier = [userMessage('optimistic-user-1'), assistantMessage('a1', false)]
    render(<ChatTranscript section={section(earlier, { isLoading: false })} />)

    expect(layout.mode()).toBe('following')
  })

  it('holds a second send, not the first one that still has its optimistic id', () => {
    const { sent, commit } = sendTurn()
    layout.setHeight('message:a2', 120)
    layout.setHeight('message:optimistic-user-3', 60)
    const answered = [...sent, assistantMessage('a2', false)]
    commit(section(answered))

    // The second send commits before its row; the latest user row is still the first send.
    const onPendingSendConsumed = vi.fn()
    const pendingSend = pendingSendAfter(answered)
    commit(section(answered, { pendingSend, onPendingSendConsumed }))
    expect(onPendingSendConsumed).not.toHaveBeenCalled()

    const second = [...answered, userMessage('optimistic-user-3')]
    commit(section(second, { pendingSend, onPendingSendConsumed }))
    expect(layout.mode()).toBe('new-turn:message:optimistic-user-3')
    expect(onPendingSendConsumed).toHaveBeenCalledOnce()
  })

  it('returns to the live end, not the previous message, when the sent one is withdrawn', () => {
    const { sent, commit } = sendTurn()
    layout.setHeight('message:a2', 120)
    commit(section([...sent, assistantMessage('a2', false)]))

    // A refused or queued send removes its optimistic row.
    commit(section(history))
    commit(section(history))

    expect(layout.mode()).toBe('following')
    expect(layout.distanceToBottom()).toBe(0)
  })

  it('holds a message sent while reading older history once the newest rows mount', () => {
    const older = Array.from({ length: 260 }, (_, index) => userMessage(`h${String(index)}`))
    const onPendingSendConsumed = vi.fn()
    const view = render(
      <ChatTranscript section={section(older.slice(0, 40), { isLoading: false })} />,
    )
    act(() => layout.userScroll(-300))
    // Rows arriving under an anchored reader cap the window, so newer rows are not mounted.
    view.rerender(<ChatTranscript section={section(older, { isLoading: false })} />)
    expect(document.body.textContent).toContain('Load newer messages')

    layout.setHeight('message:optimistic-user-2', 60)
    const sent = [...older, userMessage('optimistic-user-2')]
    view.rerender(
      <ChatTranscript
        section={section(sent, { pendingSend: pendingSendAfter(older), onPendingSendConsumed })}
      />,
    )
    act(() => layout.flushScroll())

    expect(layout.mode()).toBe('new-turn:message:optimistic-user-2')
    expect(layout.rowTop('message:optimistic-user-2')).toBe(24)
    expect(onPendingSendConsumed).toHaveBeenCalled()
  })

  it('mounts the reply under a message sent from a full live window', () => {
    // A follower's window grows to its 160-row bound as rows arrive, so the sent row is its last.
    const older = Array.from({ length: 170 }, (_, index) => userMessage(`h${String(index)}`))
    const view = render(
      <ChatTranscript section={section(older.slice(0, 40), { isLoading: false })} />,
    )
    view.rerender(<ChatTranscript section={section(older, { isLoading: false })} />)
    const sent = [...older, userMessage('optimistic-user-2')]
    view.rerender(
      <ChatTranscript section={section(sent, { pendingSend: pendingSendAfter(history) })} />,
    )
    view.rerender(<ChatTranscript section={section([...sent, assistantMessage('a2', false)])} />)

    expect(layout.rowTop('message:a2')).not.toBeNull()
    expect(document.body.textContent).not.toContain('Load newer messages')
    expect(layout.mode()).toBe('new-turn:message:optimistic-user-2')
  })
})
