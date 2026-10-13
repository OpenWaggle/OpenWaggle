import type { AgentSession, ExtensionError } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { onExtensionTurnStartFailure } from '../extension-turn-start-failure'

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

describe('a Waggle Run whose extension cannot start the next turn', () => {
  it.each(['send_message', 'send_user_message'])(
    'fails when %s reports the turn could not start, instead of waiting for it',
    (event) => {
      const { session, emit, listenerCount } = sessionWithExtensionErrors()
      const fail = vi.fn()

      const stop = onExtensionTurnStartFailure(session, fail)
      emit({ extensionPath: '<runtime>', event, error: 'Sign-in expired' })
      stop()

      expect(fail).toHaveBeenCalledWith(
        new Error('An extension could not start the next turn: Sign-in expired'),
      )
      expect(listenerCount()).toBe(0)
    },
  )

  it("keeps running through an extension's other errors", () => {
    const { session, emit } = sessionWithExtensionErrors()
    const fail = vi.fn()

    onExtensionTurnStartFailure(session, fail)
    emit({ extensionPath: '/ext/a.ts', event: 'tool_call', error: 'hook failed' })

    expect(fail).not.toHaveBeenCalled()
  })
})
