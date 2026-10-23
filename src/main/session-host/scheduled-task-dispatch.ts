import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { dispatchNonHostUiLocalSessionCommand } from '../application/local-session-command-dispatcher'
import type { SessionToolDependencies } from './session-tool-gateway-installer'

/**
 * Sends a Session Control request as a Scheduled task's creator, through the same admission and
 * authorization path the Sessions tool uses, so a task can do nothing its creator could not.
 */
export function dispatchScheduledTaskCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: Extract<
    LocalSessionCommandPayload,
    { readonly contract: 'session-control-v2' | 'session-lifecycle-v2' }
  >
}) {
  return Effect.suspend(
    (): Effect.Effect<LocalSessionCommandResult, unknown, SessionToolDependencies> =>
      dispatchNonHostUiLocalSessionCommand(input),
  )
}
