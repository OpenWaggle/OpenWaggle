import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import type { ScheduledTaskTarget } from '@shared/types/scheduled-task'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { SESSION_LIFECYCLE_CONTRACT_VERSION } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { LocalSessionCommandAuthorizationError } from '../errors'
import { authorizeLocalSessionCommand } from './local-session-command-authorization'

const PROBE_TEXT = 'Scheduled task authorization probe.'

/**
 * The Session Control request a Scheduled task run sends: a Run start for a Heartbeat, a Session
 * launch for a Launch schedule. A task never does more than its creator could do by hand, so
 * creating one is authorized as that request would be (ADR 0057), and each run sends it.
 */
export function scheduledTaskRunPayload(input: {
  readonly target: ScheduledTaskTarget
  readonly requestId: string
  readonly idempotencyKey: string
  readonly text: string
  readonly title?: string
}): Extract<
  LocalSessionCommandPayload,
  { readonly contract: 'session-control-v2' | 'session-lifecycle-v2' }
> {
  const { target } = input
  if (target.kind === 'heartbeat') {
    return {
      contract: 'session-control-v2',
      request: {
        contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        command: {
          operation: 'start',
          sessionId: target.sessionId,
          input: { text: input.text, attachmentIds: [] },
        },
      },
    }
  }
  const specialization = {
    ...(target.modelId ? { modelId: target.modelId } : {}),
    ...(target.thinkingLevel ? { thinkingLevel: target.thinkingLevel } : {}),
    ...(target.agentDefinitionName ? { agentDefinitionName: target.agentDefinitionName } : {}),
  }
  return {
    contract: 'session-lifecycle-v2',
    request: {
      contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      command: {
        operation: 'launch',
        projectPath: target.projectPath,
        ...(input.title ? { title: input.title } : {}),
        workspace: target.workspace === 'local' ? { mode: 'local' } : { mode: 'new-worktree' },
        ...(Object.keys(specialization).length > 0 ? { specialization } : {}),
        objective: input.text,
        attachmentIds: [],
      },
    },
  }
}

export type ScheduledTaskTargetAuthorization =
  | { readonly authorized: true }
  | {
      readonly authorized: false
      readonly code: 'capability_denied' | 'target_scope_denied' | 'target_not_found'
      readonly message: string
    }

function refusal(error: unknown): ScheduledTaskTargetAuthorization {
  if (error instanceof LocalSessionCommandAuthorizationError) {
    return error.code === 'capability_denied'
      ? {
          authorized: false,
          code: 'capability_denied',
          message: `You cannot do this by hand${error.missing ? ` (needs ${error.missing.join(', ')})` : ''}, so a Scheduled task cannot do it for you.`,
        }
      : {
          authorized: false,
          code: 'target_scope_denied',
          message: 'That Session or project is outside what you may reach.',
        }
  }
  return {
    authorized: false,
    code: 'target_not_found',
    message: 'That Session or project was not found.',
  }
}

/** Whether `caller` could send this task's run request by hand, checked without sending it. */
export function authorizeScheduledTaskTarget(
  caller: LocalSessionCallerIdentity,
  target: ScheduledTaskTarget,
) {
  const payload = scheduledTaskRunPayload({
    target,
    requestId: 'scheduled-task-authorization',
    idempotencyKey: 'scheduled-task-authorization',
    text: PROBE_TEXT,
  })
  return authorizeLocalSessionCommand({ caller, payload }).pipe(
    Effect.as<ScheduledTaskTargetAuthorization>({ authorized: true }),
    Effect.catchAll((error) => Effect.succeed(refusal(error))),
  )
}
