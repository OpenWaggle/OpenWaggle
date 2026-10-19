import { sessionWriterBusyMessage } from '@shared/domain/session-writer-messages'
import { SessionId } from '@shared/types/brand'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { expect, it, vi } from 'vitest'

const { dispatchLocalSessionCommandMock, warn } = vi.hoisted(() => ({
  dispatchLocalSessionCommandMock: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('../local-session-command-dispatcher', () => ({
  dispatchLocalSessionCommand: dispatchLocalSessionCommandMock,
}))
vi.mock('../../logger', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../logger')>()
  return {
    ...original,
    createLogger: (namespace: string) => ({
      ...original.createLogger(namespace),
      warn: (message: string, data?: object) => warn(namespace, message, data),
    }),
  }
})

import { dispatchHostBackedSessionGuiOperation } from '../host-ui-session-operation-dispatcher'

/**
 * A desktop fork or clone that fails is reported to the user in a toast only, so the Host log
 * keeps it too: a copy that kept failing had left nothing to diagnose it from.
 */

const SESSION_ID = SessionId('session-1')

it.each([
  ['sessions:fork-to-new', 'before'],
  ['sessions:clone-to-new', 'at'],
] as const)('logs a %s refused by a busy Session', async (channel, position) => {
  const busy = sessionWriterBusyMessage(SESSION_ID, 'tree-mutation')
  dispatchLocalSessionCommandMock.mockReturnValue(Effect.die(new Error(busy)))
  const effect = dispatchHostBackedSessionGuiOperation(channel, [SESSION_ID, 'local/model', 'n1'])

  await expect(
    Effect.runPromise(fromAny<Effect.Effect<unknown, unknown, never>, typeof effect>(effect)),
  ).rejects.toThrow(busy)

  expect(warn).toHaveBeenCalledWith(
    'host-ui-session-copy',
    'Desktop Session copy failed',
    expect.objectContaining({
      position,
      sourceSessionId: SESSION_ID,
      targetNodeId: 'n1',
      error: expect.stringContaining(busy),
    }),
  )
})

it('does not log a copy that was interrupted, as when the Host stops', async () => {
  warn.mockClear()
  dispatchLocalSessionCommandMock.mockReturnValue(Effect.interrupt)
  const effect = dispatchHostBackedSessionGuiOperation('sessions:fork-to-new', [
    SESSION_ID,
    'local/model',
    'n1',
  ])

  await Effect.runPromiseExit(
    fromAny<Effect.Effect<unknown, unknown, never>, typeof effect>(effect),
  )

  expect(warn).not.toHaveBeenCalled()
})
