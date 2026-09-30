import { matchBy } from '@diegogbrisa/ts-match'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { LocalSessionCommandAuthorizationError } from '../errors'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'

type RunInput = {
  readonly sessionId: string
  readonly runId: string
  readonly followUpId?: string
}

function runInput(payload: LocalSessionCommandPayload): RunInput | undefined {
  if (payload.contract !== 'session-control-v2') return undefined
  return matchBy(payload.request.command, 'operation')
    .with('steer', (command) => ({ sessionId: command.sessionId, runId: command.expectedRunId }))
    .with('promote', (command) => ({
      sessionId: command.sessionId,
      runId: command.expectedRunId,
      followUpId: command.followUpId,
    }))
    .with('request-respond', 'approval-respond', (command) => ({
      sessionId: command.sessionId,
      runId: command.runId,
    }))
    .otherwise(() => undefined)
}

/**
 * Refuse input into a running Run from a caller that lacks that Run's reach (ADR 0040). The Run
 * check looks at who started a Run; without this, a caller limited to one project could steer,
 * promote into, or answer a desktop Run that reaches every project and direct it elsewhere. A
 * Follow-up, which starts its own Run under the caller's reach, stays available.
 */
export function authorizeRunInputReach(
  caller: LocalSessionCallerIdentity,
  payload: LocalSessionCommandPayload,
) {
  const input = runInput(payload)
  if (!input) return Effect.void
  return Effect.gen(function* () {
    const repository = yield* SessionAuthorizationTargetRepository
    if (!repository.runInputWidensReach) return
    const widens = yield* repository.runInputWidensReach({ callerId: caller.callerId, ...input })
    if (widens) {
      return yield* Effect.fail(
        new LocalSessionCommandAuthorizationError({ code: 'target_scope_denied' }),
      )
    }
  })
}
