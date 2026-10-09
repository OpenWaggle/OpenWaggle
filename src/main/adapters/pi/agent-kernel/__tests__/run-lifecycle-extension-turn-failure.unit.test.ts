import type { AgentSession, ExtensionError } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { runPiOperation } from '../run-lifecycle-failure'

/** A session whose extension runner reports errors the way Pi's does. */
function sessionWithExtensionErrors() {
  const listeners = new Set<(error: ExtensionError) => void>()
  const session = fromPartial<AgentSession>({
    extensionRunner: {
      onError: (listener: (error: ExtensionError) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  })
  const emit = (error: ExtensionError) => {
    for (const listener of listeners) listener(error)
  }
  return { session, emit, listenerCount: () => listeners.size }
}

describe('a Run whose extension cannot start the next turn', () => {
  it.each(['send_message', 'send_user_message'])(
    'fails when %s reports the turn could not start, instead of waiting for it',
    async (event) => {
      const { session, emit, listenerCount } = sessionWithExtensionErrors()

      const outcome = runPiOperation(() => new Promise<void>(() => {}), session)
      emit({ extensionPath: '<runtime>', event, error: 'Sign-in expired' })

      await expect(outcome).resolves.toMatchObject({
        status: 'failed',
        error: expect.objectContaining({
          message: 'An extension could not start the next turn: Sign-in expired',
        }),
      })
      expect(listenerCount()).toBe(0)
    },
  )

  it("keeps running through an extension's other errors", async () => {
    const { session, emit } = sessionWithExtensionErrors()
    let finish = () => {}
    const outcome = runPiOperation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
      session,
    )

    emit({ extensionPath: '/ext/a.ts', event: 'tool_call', error: 'hook failed' })
    finish()

    await expect(outcome).resolves.toEqual({ status: 'completed' })
  })
})
