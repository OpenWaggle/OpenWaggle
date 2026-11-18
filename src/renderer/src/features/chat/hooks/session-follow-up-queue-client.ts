import type { SessionId } from '@shared/types/brand'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationCommand,
  type SessionControlMutationResponse,
} from '@shared/types/session-control'
import { api } from '@/shared/lib/ipc'
import { withForegroundSend } from '../state/foreground-send-store'
import { useQueuedRunStartStore } from '../state/queued-run-start-store'
import { settledSessionSettingWrites } from '../state/session-setting-writes'
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
 * Sends a queue change that can start a Run on an idle Session (resuming, sending as the user,
 * ending an edit, withdrawing the message that blocked delivery). The Host starts that Run with
 * the Session's model and thinking level, so a pick made just before lands first, and the
 * Session counts as starting a Run from the request until the Run reports `agent_start`: its
 * settings stay locked the whole way, so the Host never refuses a pick the user could make.
 */
export function mutateMayStartRun(sessionId: SessionId, command: SessionControlMutationCommand) {
  return withForegroundSend(sessionId, async () => {
    await settledSessionSettingWrites(sessionId)
    const response = await mutate(command)
    if (response.outcome.effect === 'started-run') {
      useQueuedRunStartStore.getState().mark(sessionId, response.outcome.runId)
    }
    return response
  })
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
