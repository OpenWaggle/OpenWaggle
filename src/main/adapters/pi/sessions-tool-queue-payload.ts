import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationCommand,
} from '@shared/types/session-control'
import type { SessionsToolParameters } from './sessions-tool-parameters'

type QueueInput = Extract<
  SessionsToolParameters,
  {
    action:
      | 'queue_withdraw'
      | 'queue_reorder'
      | 'queue_pause'
      | 'queue_resume'
      | 'queue_update_authorization'
  }
>

export function isSessionsToolQueueAction(input: SessionsToolParameters): input is QueueInput {
  return input.action.startsWith('queue_') && input.action !== 'queue_list'
}

export function buildSessionsToolQueuePayload(input: QueueInput): LocalSessionCommandPayload {
  const command: SessionControlMutationCommand =
    input.action === 'queue_withdraw'
      ? {
          operation: 'queue-withdraw' as const,
          sessionId: input.sessionId,
          followUpIds: input.followUpIds,
        }
      : input.action === 'queue_reorder'
        ? {
            operation: 'queue-reorder' as const,
            sessionId: input.sessionId,
            expectedQueueRevision: input.queueRevision,
            orderedFollowUpIds: input.followUpIds,
          }
        : input.action === 'queue_update_authorization'
          ? {
              operation: 'queue-update-authorization' as const,
              sessionId: input.sessionId,
              followUpId: input.followUpId,
              runAuthorizationOverride:
                input.authorization === 'inherit' ? null : input.authorization,
            }
          : input.action === 'queue_pause'
            ? {
                operation: 'queue-pause',
                sessionId: input.sessionId,
                expectedQueueRevision: input.queueRevision,
              }
            : {
                operation: 'queue-resume',
                sessionId: input.sessionId,
                expectedQueueRevision: input.queueRevision,
              }
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      command,
    },
  }
}
