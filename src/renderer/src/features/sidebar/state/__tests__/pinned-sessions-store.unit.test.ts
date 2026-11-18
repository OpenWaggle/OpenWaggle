/**
 * localStorage persistence is the point of this suite, so it needs a DOM: the store
 * deliberately falls back to in-memory storage when `window` is absent.
 *
 * @vitest-environment jsdom
 */
import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listPinnedSessionsMock, movePinnedSessionMock, pinSessionMock, unpinSessionMock } =
  vi.hoisted(() => ({
    listPinnedSessionsMock: vi.fn(),
    movePinnedSessionMock: vi.fn(),
    pinSessionMock: vi.fn(),
    unpinSessionMock: vi.fn(),
  }))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listPinnedSessions: listPinnedSessionsMock,
    movePinnedSession: movePinnedSessionMock,
    pinSession: pinSessionMock,
    unpinSession: unpinSessionMock,
  },
}))

const STORAGE_KEY = 'openwaggle:pinned-sessions:v1'

async function loadStore() {
  const module = await import('../pinned-sessions-store')
  return module.usePinnedSessionsStore
}

/**
 * Pinned sessions store (issue #97, ADR 0019).
 *
 * The split matters: the Pinned sort is a local view preference and is persisted, while
 * Manual order belongs to the database and must never be written to localStorage — a
 * restored stale mirror would silently disagree with the pins the main process holds.
 */
describe('pinned sessions store', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    listPinnedSessionsMock.mockResolvedValue([])
    pinSessionMock.mockResolvedValue(undefined)
    unpinSessionMock.mockResolvedValue(undefined)
    movePinnedSessionMock.mockResolvedValue(undefined)
    window.localStorage.clear()
    vi.resetModules()
  })

  it('defaults to Manual order', async () => {
    const store = await loadStore()

    expect(store.getState().sortMode).toBe('manual')
    expect(store.getState().pins).toStrictEqual([])
  })

  it('persists the Pinned sort choice to localStorage', async () => {
    const store = await loadStore()

    store.getState().setSortMode('name')

    const persisted = window.localStorage.getItem(STORAGE_KEY)
    expect(persisted).toBeTruthy()
    expect(JSON.parse(persisted ?? '{}').state.sortMode).toBe('name')
  })

  it('restores a persisted sort choice on reload', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { sortMode: 'oldest' }, version: 1 }),
    )

    const store = await loadStore()

    expect(store.getState().sortMode).toBe('oldest')
  })

  it('never persists pins: Manual order lives in the database', async () => {
    const store = await loadStore()
    store.setState({
      pins: [{ sessionId: SessionId('session-a'), pinnedAt: 1, sortKey: 'i' }],
    })

    store.getState().setSortMode('recent')

    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(persisted.state.sortMode).toBe('recent')
    expect(persisted.state.pins).toBeUndefined()
  })

  it('loads pins from the main process', async () => {
    const pins = [{ sessionId: SessionId('session-a'), pinnedAt: 1, sortKey: 'i' }]
    listPinnedSessionsMock.mockResolvedValue(pins)
    const store = await loadStore()

    await store.getState().loadPins()

    expect(store.getState().pins).toStrictEqual(pins)
  })

  it('pins, then reloads so Manual order comes back from the source of truth', async () => {
    const store = await loadStore()

    await store.getState().pinSession(SessionId('session-a'))

    expect(pinSessionMock).toHaveBeenCalledWith(SessionId('session-a'))
    expect(listPinnedSessionsMock).toHaveBeenCalledTimes(1)
  })

  it('unpins, then reloads', async () => {
    const store = await loadStore()

    await store.getState().unpinSession(SessionId('session-a'))

    expect(unpinSessionMock).toHaveBeenCalledWith(SessionId('session-a'))
    expect(listPinnedSessionsMock).toHaveBeenCalledTimes(1)
  })

  it('moves a pin by neighbours, then reloads', async () => {
    const store = await loadStore()

    await store.getState().movePin(SessionId('session-c'), {
      afterSessionId: SessionId('session-a'),
      beforeSessionId: SessionId('session-b'),
    })

    expect(movePinnedSessionMock).toHaveBeenCalledWith({
      sessionId: SessionId('session-c'),
      afterSessionId: SessionId('session-a'),
      beforeSessionId: SessionId('session-b'),
    })
    expect(listPinnedSessionsMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous pins when a load fails', async () => {
    const pins = [{ sessionId: SessionId('session-a'), pinnedAt: 1, sortKey: 'i' }]
    const store = await loadStore()
    store.setState({ pins })
    listPinnedSessionsMock.mockRejectedValue(new Error('ipc down'))

    await store.getState().loadPins()

    expect(store.getState().pins).toStrictEqual(pins)
  })

  it('does not throw when a mutation fails', async () => {
    pinSessionMock.mockRejectedValue(new Error('ipc down'))
    const store = await loadStore()

    await expect(store.getState().pinSession(SessionId('session-a'))).resolves.toBeUndefined()
  })
})
