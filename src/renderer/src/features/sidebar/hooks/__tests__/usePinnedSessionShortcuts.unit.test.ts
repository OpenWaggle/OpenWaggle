/**
 * Pinned shortcuts (issue #97): Mod+1..Mod+9 by rendered position.
 *
 * @vitest-environment jsdom
 */
import { SessionId } from '@shared/types/brand'
import type { PinnedSession, SessionSummary } from '@shared/types/session'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface RegisteredHotkey {
  readonly hotkey: string
  readonly callback: () => void
}

const { navigateMock, registeredHotkeys, setActiveSessionMock, sessionsRef } = vi.hoisted(() => {
  const hotkeys: { hotkey: string; callback: () => void }[] = []
  const sessions: { sessions: SessionSummary[] } = { sessions: [] }
  return {
    navigateMock: vi.fn(),
    registeredHotkeys: hotkeys,
    setActiveSessionMock: vi.fn(),
    sessionsRef: sessions,
  }
})

vi.mock('@tanstack/react-hotkeys', () => ({
  useHotkeys: (definitions: readonly RegisteredHotkey[]) => {
    registeredHotkeys.length = 0
    registeredHotkeys.push(...definitions)
  },
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigateMock }))

vi.mock('@/features/chat/state', () => ({
  useChatStore: { getState: () => ({ setActiveSession: setActiveSessionMock }) },
}))

vi.mock('@/features/sessions/hooks', () => ({
  useSessions: () => sessionsRef,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listPinnedSessions: vi.fn(async () => []),
    pinSession: vi.fn(),
    unpinSession: vi.fn(),
    movePinnedSession: vi.fn(),
  },
}))

import { PINNED_SHORTCUT_LIMIT } from '../../lib/pinned-sessions'
import { usePinnedSessionsStore } from '../../state/pinned-sessions-store'
import { PINNED_SHORTCUT_HOTKEYS, usePinnedSessionShortcuts } from '../usePinnedSessionShortcuts'

function session(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: SessionId(id),
    title: id,
    projectPath: '/repo/one',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const pin = (id: string, sortKey: string): PinnedSession => ({
  sessionId: SessionId(id),
  pinnedAt: 1,
  sortKey,
})

const press = (position: number) => {
  const entry = registeredHotkeys.find((item) => item.hotkey === `Mod+${position}`)
  if (!entry) throw new Error(`No hotkey registered for position ${position}`)
  entry.callback()
}

describe('pinned session shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registeredHotkeys.length = 0
    window.localStorage.clear()
    usePinnedSessionsStore.setState({ pins: [], sortMode: 'manual' })
  })

  it('registers exactly one hotkey per shortcut position', () => {
    sessionsRef.sessions = []
    renderHook(() => usePinnedSessionShortcuts())

    expect(registeredHotkeys.map((entry) => entry.hotkey)).toStrictEqual([
      ...PINNED_SHORTCUT_HOTKEYS,
    ])
    expect(PINNED_SHORTCUT_HOTKEYS).toHaveLength(PINNED_SHORTCUT_LIMIT)
  })

  it('opens the session at the pressed position', () => {
    sessionsRef.sessions = [session('a'), session('b'), session('c')]
    usePinnedSessionsStore.setState({
      pins: [pin('a', 'i'), pin('b', 'm'), pin('c', 'q')],
    })
    renderHook(() => usePinnedSessionShortcuts())

    press(2)

    expect(setActiveSessionMock).toHaveBeenCalledWith(SessionId('b'))
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: 'b' },
    })
  })

  it('re-derives after a Pinned sort change, following what is rendered', () => {
    sessionsRef.sessions = [session('a', { title: 'Zebra' }), session('b', { title: 'Apple' })]
    usePinnedSessionsStore.setState({ pins: [pin('a', 'i'), pin('b', 'm')] })
    const { rerender } = renderHook(() => usePinnedSessionShortcuts())

    press(1)
    expect(setActiveSessionMock).toHaveBeenLastCalledWith(SessionId('a'))

    usePinnedSessionsStore.setState({ sortMode: 'name' })
    rerender()

    press(1)
    expect(setActiveSessionMock).toHaveBeenLastCalledWith(SessionId('b'))
  })

  it('re-derives after a reorder', () => {
    sessionsRef.sessions = [session('a'), session('b')]
    usePinnedSessionsStore.setState({ pins: [pin('a', 'i'), pin('b', 'm')] })
    const { rerender } = renderHook(() => usePinnedSessionShortcuts())

    press(1)
    expect(setActiveSessionMock).toHaveBeenLastCalledWith(SessionId('a'))

    // b dragged above a: the main process returns new keys, not new positions.
    usePinnedSessionsStore.setState({ pins: [pin('a', 'i'), pin('b', 'c')] })
    rerender()

    press(1)
    expect(setActiveSessionMock).toHaveBeenLastCalledWith(SessionId('b'))
  })

  it('does nothing for a position with no row, including past the ninth', () => {
    sessionsRef.sessions = [session('a')]
    usePinnedSessionsStore.setState({ pins: [pin('a', 'i')] })
    renderHook(() => usePinnedSessionShortcuts())

    press(2)
    press(9)

    expect(setActiveSessionMock).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('ignores a pin whose session is archived or gone when mapping positions', () => {
    sessionsRef.sessions = [session('b')]
    usePinnedSessionsStore.setState({ pins: [pin('gone', 'i'), pin('b', 'm')] })
    renderHook(() => usePinnedSessionShortcuts())

    press(1)

    expect(setActiveSessionMock).toHaveBeenCalledWith(SessionId('b'))
  })

  it('maps the tenth pin to no shortcut while leaving the first nine intact', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    sessionsRef.sessions = ids.map((id) => session(id))
    usePinnedSessionsStore.setState({
      pins: ids.map((id, index) => pin(id, `m${String.fromCharCode(97 + index)}`)),
    })
    renderHook(() => usePinnedSessionShortcuts())

    press(9)
    expect(setActiveSessionMock).toHaveBeenLastCalledWith(SessionId('i'))
    expect(registeredHotkeys).toHaveLength(PINNED_SHORTCUT_LIMIT)
    expect(registeredHotkeys.some((entry) => entry.hotkey === 'Mod+10')).toBe(false)
  })
})
