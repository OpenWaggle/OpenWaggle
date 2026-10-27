import { randomUUID } from 'node:crypto'
import { getParseIssues } from '@shared/schema'
import { decodeScheduledTasksRequest } from '@shared/schemas/scheduled-task'
import { SCHEDULED_TASKS_CONTRACT_VERSION } from '@shared/types/scheduled-task'
import * as Effect from 'effect/Effect'
import { dispatchGuiSessionCommand } from '../application/gui-session-command'
import { typedHandle } from './typed-ipc'

function invalidCommandError(error: unknown) {
  const issues = getParseIssues(error)
  const detail = issues ? issues.join('; ') : String(error)
  return new Error(`Invalid Scheduled tasks command: ${detail}`)
}

/**
 * The GUI manages Scheduled tasks as the local user through the Session Host's
 * `scheduled-tasks-v1` contract (ADR 0057); the Host owns every record and its authority checks.
 */
export function registerScheduledTasksHandlers(): void {
  typedHandle('scheduled-tasks:execute', (_event, command: unknown, idempotencyKey?: unknown) =>
    Effect.gen(function* () {
      const requestId = randomUUID()
      const request = yield* Effect.try({
        try: () =>
          decodeScheduledTasksRequest({
            contractVersion: SCHEDULED_TASKS_CONTRACT_VERSION,
            requestId,
            command,
            ...(idempotencyKey ? { idempotencyKey } : {}),
          }),
        catch: invalidCommandError,
      })
      const result = yield* dispatchGuiSessionCommand({
        caller: { callerId: 'gui:local-user' },
        payload: { contract: 'scheduled-tasks-v1', request },
      })
      if (result.contract !== 'scheduled-tasks-v1' || result.response.requestId !== requestId) {
        return yield* Effect.fail(
          new Error('Session Host returned an invalid Scheduled tasks response.'),
        )
      }
      return result.response.outcome
    }),
  )
}
