import type { AgentSession } from '@earendil-works/pi-coding-agent'

/** Extension calls that start a turn and only report their failure to Pi's error listeners. */
const TURN_START_EVENTS = new Set(['send_message', 'send_user_message'])

/**
 * Calls `fail` when an extension reports that a turn it asked for could not start. A Waggle Run
 * waits for the turns its loop starts with `pi.sendMessage(..., { triggerTurn: true })`, which does
 * not wait for them, so nothing else would end it. A classic Run does not need this: Pi finishes
 * its turn, as with `pi.sendUserMessage()` sent while it streams. Returns the unsubscribe.
 */
export function onExtensionTurnStartFailure(
  session: Pick<AgentSession, 'extensionRunner'>,
  fail: (error: Error) => void,
) {
  return session.extensionRunner.onError((error) => {
    if (TURN_START_EVENTS.has(error.event)) {
      fail(new Error(`An extension could not start the next turn: ${error.error}`))
    }
  })
}
