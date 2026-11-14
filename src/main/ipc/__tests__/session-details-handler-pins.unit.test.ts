import { SessionId } from '@shared/types/brand'
import type { PinnedSession } from '@shared/types/session'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  dispatchLocalSessionCommandMock,
  listPinnedSessionsMock,
  loadSessionDetailsHandlers,
  resetSessionDetailsHandlerMocks,
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

  const move = (afterSessionId: SessionId | null, beforeSessionId: SessionId | null) => ({
    sessionId: SessionId('session-c'),
    afterSessionId,
    beforeSessionId,
  })

  it.each([
    ['sessions:pins:pin', SessionId('session-a'), { operation: 'pin', sessionId: 'session-a' }],
    ['sessions:pins:unpin', SessionId('session-a'), { operation: 'unpin', sessionId: 'session-a' }],
    ...[
      move(SessionId('session-a'), SessionId('session-b')),
      move(null, SessionId('session-a')),
      move(SessionId('session-b'), null),
    ].map(
      (bounds) => ['sessions:pins:move', bounds, { operation: 'move-pin', ...bounds }] as const,
    ),
  ] as const)('forwards %s %j to the Session Host', async (channel, argument, command) => {
    await getInvokeHandler(channel)?.({}, argument)

    expect(dispatchLocalSessionCommandMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          request: expect.objectContaining({ command }),
        }),
      }),
    )
  })
})
