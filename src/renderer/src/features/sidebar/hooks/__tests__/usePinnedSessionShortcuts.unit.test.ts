/**
 * Pinned shortcuts (issue #97): Mod+1..Mod+9 by rendered position.
 *
 * @vitest-environment jsdom
 */
import { SessionId } from '@shared/types/brand'
import type { PinnedSession, SessionSummary } from '@shared/types/session'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useSessionStore } from '@/features/sessions/state'
import { renderInMemoryRouter } from '@/test-utils/memory-router'

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    // Opening a Session reads its detail; the read stays in flight, so the open Session holds.
    getSessionDetail: () => new Promise(() => {}),
  }),
}))

import { PINNED_SHORTCUT_LIMIT } from '../../lib/pinned-sessions'
import { usePinnedSessionsStore } from '../../state/pinned-sessions-store'
import { PINNED_SHORTCUT_HOTKEYS, usePinnedSessionShortcuts } from '../usePinnedSessionShortcuts'

/*
 * Only the preload is replaced: the hotkey manager, the memory router and the chat, Session and
 * Pinned stores are the real ones, so a case presses a key and asserts which Session opens.
 */
function session(id: string, overrides: Partial<SessionSummary> = {}) {
  return {
    id: SessionId(id),
    title: id,
    projectPath: '/repo/one',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } satisfies SessionSummary
}

const pin = (id: string, sortKey: string) =>
  ({
    sessionId: SessionId(id),
    pinnedAt: 1,
    sortKey,
  }) satisfies PinnedSession

function ShortcutsProbe() {
  usePinnedSessionShortcuts()
  return null
}

function seed(sessions: readonly SessionSummary[], pins: readonly PinnedSession[]) {
  useSessionStore.setState({ sessions: [...sessions] })
  usePinnedSessionsStore.setState({ pins: [...pins] })
}

async function renderShortcuts() {
  const { router } = await renderInMemoryRouter(createElement(ShortcutsProbe))
  return {
    /** Mod is Control under jsdom's Linux user agent. */
    press: (position: number) => {
      fireEvent.keyDown(document.body, {
        key: String(position),
        code: `Digit${String(position)}`,
        ctrlKey: true,
      })
    },
    pathname: () => router.state.location.pathname,
  }
}

async function expectOpened(view: { readonly pathname: () => string }, id: string) {
  expect(useChatStore.getState().activeSessionId).toBe(SessionId(id))
  await waitFor(() => expect(view.pathname()).toBe(`/sessions/${id}`))
}

describe('pinned session shortcuts', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState())
    useSessionStore.setState(useSessionStore.getInitialState())
    usePinnedSessionsStore.setState({ pins: [], sortMode: 'manual' })
  })

  afterEach(() => {
    // The unit tier does not unmount between cases, and each mounted hook registers its hotkeys.
    cleanup()
    useChatStore.setState(useChatStore.getInitialState())
    useSessionStore.setState(useSessionStore.getInitialState())
  })

  it.each([
    {
      label: 'the session at the pressed position',
      sessions: [session('a'), session('b'), session('c')],
      pins: [pin('a', 'i'), pin('b', 'm'), pin('c', 'q')],
      position: 2,
      opened: 'b',
    },
    {
      label: 'past a pin whose session is archived or gone',
      sessions: [session('b')],
      pins: [pin('gone', 'i'), pin('b', 'm')],
      position: 1,
      opened: 'b',
    },
  ])('opens $label', async ({ sessions, pins, position, opened }) => {
    seed(sessions, pins)
    const view = await renderShortcuts()

    view.press(position)

    await expectOpened(view, opened)
  })

  it('does nothing for a position with no row, including the ninth', async () => {
    seed([session('a')], [pin('a', 'i')])
    const view = await renderShortcuts()
    // A callback that threw would surface as an uncaught error from the key event.
    const uncaught: unknown[] = []
    const record = (event: ErrorEvent) => {
      uncaught.push(event.error)
      event.preventDefault()
    }
    window.addEventListener('error', record)

    view.press(2)
    view.press(9)

    expect(useChatStore.getState().activeSessionId).toBeNull()
    expect(view.pathname()).toBe('/')
    window.removeEventListener('error', record)
    expect(uncaught).toEqual([])
  })

  it.each([
    {
      label: 'a Pinned sort change',
      sessions: [session('a', { title: 'Zebra' }), session('b', { title: 'Apple' })],
      change: () => usePinnedSessionsStore.setState({ sortMode: 'name' }),
    },
    {
      label: 'a reorder',
      sessions: [session('a'), session('b')],
      // b dragged above a: the main process returns new keys, not new positions.
      change: () => usePinnedSessionsStore.setState({ pins: [pin('a', 'i'), pin('b', 'c')] }),
    },
  ])('re-derives the positions after $label, following what is rendered', async (row) => {
    seed(row.sessions, [pin('a', 'i'), pin('b', 'm')])
    const view = await renderShortcuts()

    view.press(1)
    await expectOpened(view, 'a')

    act(() => {
      row.change()
    })
    view.press(1)

    await expectOpened(view, 'b')
  })

  it('gives the first nine pins a shortcut each and the tenth none', async () => {
    // The badges render from PINNED_SHORTCUT_LIMIT, so the hotkeys must cover exactly that many.
    expect(PINNED_SHORTCUT_HOTKEYS).toHaveLength(PINNED_SHORTCUT_LIMIT)
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    seed(
      ids.map((id) => session(id)),
      ids.map((id, index) => pin(id, `m${String.fromCharCode(97 + index)}`)),
    )
    const view = await renderShortcuts()

    for (const [index, id] of ids.slice(0, PINNED_SHORTCUT_LIMIT).entries()) {
      view.press(index + 1)
      await expectOpened(view, id)
    }
  })
})
