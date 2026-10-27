/**
 * The desktop window's Session commands: always relayed to the Session Host it is attached to
 * (ADR 0030). Unlike `dispatchLocalSessionCommand`, this never falls back to dispatching in this
 * process, so the window loads none of the Host's dispatch graph (A-F5).
 */
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { dispatchConfiguredGuiSessionCommand } from './gui-session-command-router'

export class GuiSessionCommandNotAttachedError extends Error {
  constructor() {
    super('This window is not attached to the Session Host.')
    this.name = 'GuiSessionCommandNotAttachedError'
  }
}

export function dispatchGuiSessionCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: LocalSessionCommandPayload
}) {
  return (
    dispatchConfiguredGuiSessionCommand(input) ??
    Effect.fail(new GuiSessionCommandNotAttachedError())
  )
}
