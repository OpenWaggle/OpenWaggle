import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { TerminalService } from '../../ports/terminal-service'
import {
  deleteSessionMock,
  loadSessionDetailsHandlers,
  resetSessionDetailsHandlerMocks,
} from './session-details-handler.test-harness'
import { getInvokeHandler } from './session-details-handler.test-layers'

const recordedCloseAllForOwner: Array<readonly [string, boolean]> = []

const RecordingTerminalServiceLayer = Layer.succeed(
  TerminalService,
  TerminalService.of({
    open: () => Effect.succeed({ history: '', outputBytes: 0, running: false }),
    write: () => Effect.void,
    resize: () => Effect.void,
    clear: () => Effect.void,
    restart: () => Effect.succeed({ history: '', outputBytes: 0, running: false }),
    close: () => Effect.void,
    closeAllForOwner: (ownerKey, deleteHistory) => {
      recordedCloseAllForOwner.push([ownerKey, deleteHistory])
      return Effect.void
    },
    closeAllUnderPath: () => Effect.void,
    attachSurface: () => Effect.void,
    detachTerminal: () => Effect.void,
    detachSurface: () => Effect.void,
    closeAll: () => Effect.void,
  }),
)

describe('session deletion terminal cleanup', () => {
  let registerSessionDetailsHandlers: Awaited<
    ReturnType<typeof loadSessionDetailsHandlers>
  >['registerSessionDetailsHandlers']

  beforeEach(async () => {
    resetSessionDetailsHandlerMocks()
    deleteSessionMock.mockResolvedValue(undefined)
    recordedCloseAllForOwner.length = 0
    ;({ registerSessionDetailsHandlers } = await loadSessionDetailsHandlers())
  })

  it('closes the deleted session terminals and deletes their scrollback', async () => {
    registerSessionDetailsHandlers()
    const handler = getInvokeHandler('sessions:delete', [RecordingTerminalServiceLayer])

    await handler?.({}, 'session-delete')

    expect(recordedCloseAllForOwner).toEqual([['session-delete', true]])
    expect(deleteSessionMock).toHaveBeenCalledWith('session-delete')
  })
})
