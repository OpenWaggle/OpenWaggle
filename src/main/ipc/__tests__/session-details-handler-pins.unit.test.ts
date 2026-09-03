import { SessionId } from '@shared/types/brand'
import type { PinnedSession } from '@shared/types/session'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  listPinnedSessionsMock,
  loadSessionDetailsHandlers,
  movePinnedSessionMock,
  pinSessionMock,
  resetSessionDetailsHandlerMocks,
  unpinSessionMock,
} from './session-details-handler.test-harness'
import { getInvokeHandler } from './session-details-handler.test-layers'

/**
 * Pinned session IPC channels (issue #97).
 *
 * These assert wiring only — that each channel exists and forwards to the port.
 * Ordering, cascade and restart behaviour belong to the store and are covered by
 * `src/main/store/__tests__/pinned-sessions.integration.test.ts` against real SQLite.
 */
describe('pinned session IPC handlers', () => {
  let registerSessionDetailsHandlers: Awaited<
    ReturnType<typeof loadSessionDetailsHandlers>
  >['registerSessionDetailsHandlers']

  beforeEach(async () => {
    resetSessionDetailsHandlerMocks()
    ;({ registerSessionDetailsHandlers } = await loadSessionDetailsHandlers())
    registerSessionDetailsHandlers()
  })

  it('lists pins in Manual order as a plain array', async () => {
    const pins: PinnedSession[] = [
      { sessionId: SessionId('session-a'), pinnedAt: 1, sortKey: 'i' },
      { sessionId: SessionId('session-b'), pinnedAt: 2, sortKey: 'q' },
    ]
    listPinnedSessionsMock.mockResolvedValue(pins)

    const result = await getInvokeHandler('sessions:pins:list')?.({})

    expect(result).toStrictEqual(pins)
    expect(Array.isArray(result)).toBe(true)
    expect(listPinnedSessionsMock).toHaveBeenCalledTimes(1)
  })

  it('pins a session by id', async () => {
    await getInvokeHandler('sessions:pins:pin')?.({}, SessionId('session-a'))

    expect(pinSessionMock).toHaveBeenCalledWith(SessionId('session-a'))
  })

  it('unpins a session by id', async () => {
    await getInvokeHandler('sessions:pins:unpin')?.({}, SessionId('session-a'))

    expect(unpinSessionMock).toHaveBeenCalledWith(SessionId('session-a'))
  })

  it('forwards a move with both neighbour bounds', async () => {
    const move = {
      sessionId: SessionId('session-c'),
      afterSessionId: SessionId('session-a'),
      beforeSessionId: SessionId('session-b'),
    }

    await getInvokeHandler('sessions:pins:move')?.({}, move)

    expect(movePinnedSessionMock).toHaveBeenCalledWith(move)
  })

  it('forwards a move to either end, where a bound is null', async () => {
    const toTop = {
      sessionId: SessionId('session-c'),
      afterSessionId: null,
      beforeSessionId: SessionId('session-a'),
    }
    const toEnd = {
      sessionId: SessionId('session-c'),
      afterSessionId: SessionId('session-b'),
      beforeSessionId: null,
    }

    await getInvokeHandler('sessions:pins:move')?.({}, toTop)
    await getInvokeHandler('sessions:pins:move')?.({}, toEnd)

    expect(movePinnedSessionMock).toHaveBeenNthCalledWith(1, toTop)
    expect(movePinnedSessionMock).toHaveBeenNthCalledWith(2, toEnd)
  })
})
