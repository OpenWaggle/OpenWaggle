import type { SessionId } from '@shared/types/brand'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationCommand,
  type SessionControlMutationResponse,
} from '@shared/types/session-control'
import { api } from '@/shared/lib/ipc'
import { queueSnapshot, SessionControlRejectedError } from './session-follow-up-queue-model'

/** Reads a Session's Follow-up queue with bodies, as this desktop user sees it. */
export async function readQueue(sessionId: SessionId) {
  const response = await api.querySessionControl({
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: crypto.randomUUID(),
    query: { operation: 'queue-list', sessionId, includeBodies: true },
  })
  return queueSnapshot(response.outcome)
}

function rejected(response: SessionControlMutationResponse) {
  return response.outcome.effect === 'rejected'
    ? new SessionControlRejectedError(response.outcome.operation, response.outcome.code)
    : null
}

/** Sends one Session Control mutation; a rejection throws `SessionControlRejectedError`. */
export async function mutate(command: SessionControlMutationCommand) {
  const response = await api.mutateSessionControl({
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    command,
  })
  const error = rejected(response)
  if (error) throw error
  return response
}

/**
 * Binds a Follow-up edit hold this user holds to this window, so it renews the hold and releases
 * it when the window closes; `false` when the Host no longer has the hold.
 */
export function adoptHeldEdit(hold: {
  readonly sessionId: string
  readonly followUpId: string
  readonly holdId: string
}) {
  return api.adoptFollowUpEdit(hold)
}
