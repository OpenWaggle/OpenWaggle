import { matchBy } from '@diegogbrisa/ts-match'
import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type {
  SessionAuthorizationSetMutationRequest,
  SessionControlFollowUpMutationRequest,
  SessionControlInterruptDescendantsMutationRequest,
  SessionControlInterruptMutationRequest,
  SessionControlMessageMutationRequest,
  SessionControlMutationRequest,
  SessionControlMutationResponse,
  SessionControlPromoteMutationRequest,
  SessionControlQueueMutationRequest,
  SessionControlReplaceMutationRequest,
  SessionControlStartMutationRequest,
  SessionControlSteerMutationRequest,
  SessionInteractionResponseMutationRequest,
} from '@shared/types/session-control'
import type * as Effect from 'effect/Effect'
import type { AgentRunInterruptionService } from '../ports/agent-run-interruption-service'
import type { AgentSteeringService } from '../ports/agent-steering-service'
import type { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import type { SessionControlAttachmentService } from '../ports/session-control-attachment-service'
import type { SessionControlIdentityService } from '../ports/session-control-identity-service'
import type { SessionControlOperationJournal } from '../ports/session-control-operation-journal'
import type { SessionControlRepository } from '../ports/session-control-repository'
import type { SessionDelegationRepository } from '../ports/session-delegation-repository'
import type { SessionDescendantRunRepository } from '../ports/session-descendant-run-repository'
import type { SessionExportArtifactWriter } from '../ports/session-export-artifact-writer'
import type { SessionExportOperationRepository } from '../ports/session-export-operation-repository'
import type { SessionExportResourceResolver } from '../ports/session-export-resource-resolver'
import type { SessionOrchestrationUpdateDeliveryService } from '../ports/session-orchestration-update-delivery-service'
import type { SessionOrganizationRepository } from '../ports/session-organization-repository'
import type { SessionProjectionRepository } from '../ports/session-projection-repository'
import type { SessionQueryRepository } from '../ports/session-query-repository'
import type { SessionReportDeliveryService } from '../ports/session-report-delivery-service'
import type { SessionReportRepository } from '../ports/session-report-repository'
import type { SessionWorkspaceHandoffService } from '../ports/session-workspace-handoff-service'
import { setSessionAuthorization } from './session-authorization-service'
import {
  interruptSessionDescendants,
  interruptSessionRun,
  steerSessionRun,
} from './session-control-external-service'
import { promoteSessionFollowUp } from './session-control-promotion-service'
import { replaceSessionRun } from './session-control-replacement-service'
import { executeResourceSessionControlCommand } from './session-control-resource-command-dispatch'
import {
  mutateSessionQueue,
  queueSessionFollowUp,
  startSessionRun,
  submitSessionMessage,
} from './session-control-service'
import { respondToSessionInteraction } from './session-interaction-service'

interface ExecuteCommandInput {
  readonly callerId: string
  readonly request: SessionControlMutationRequest
  readonly authority?: LocalSessionProfileAuthority
  readonly hostRunCeiling?: number
}

export type SessionControlCommandDependencies =
  | SqlClient.SqlClient
  | AgentRunInterruptionService
  | AgentSteeringService
  | SessionAuthorizationTargetRepository
  | SessionControlAttachmentService
  | SessionControlIdentityService
  | SessionControlOperationJournal
  | SessionControlRepository
  | SessionDescendantRunRepository
  | SessionExportArtifactWriter
  | SessionExportOperationRepository
  | SessionExportResourceResolver
  | SessionQueryRepository
  | SessionReportRepository
  | SessionReportDeliveryService
  | SessionProjectionRepository
  | SessionDelegationRepository
  | SessionOrchestrationUpdateDeliveryService
  | SessionOrganizationRepository
  | SessionWorkspaceHandoffService

type Command = SessionControlMutationRequest['command']
type Commands<Operation extends Command['operation']> = Extract<
  Command,
  { readonly operation: Operation }
>

function executeRunOrQueueCommand(
  input: ExecuteCommandInput,
  command: Commands<
    | 'message'
    | 'start'
    | 'follow-up'
    | 'queue-withdraw'
    | 'queue-reorder'
    | 'queue-pause'
    | 'queue-resume'
    | 'queue-update-authorization'
  >,
) {
  const { authority, callerId, request, hostRunCeiling } = input
  return matchBy(command, 'operation')
    .with('message', (command) =>
      submitSessionMessage({
        callerId,
        ...(authority ? { callerAuthorizationCeiling: authority.authorizationCeiling } : {}),
        ...(hostRunCeiling ? { hostRunCeiling } : {}),
        request: { ...request, command } satisfies SessionControlMessageMutationRequest,
      }),
    )
    .with('start', (command) =>
      startSessionRun({
        callerId,
        ...(authority ? { callerAuthorizationCeiling: authority.authorizationCeiling } : {}),
        ...(hostRunCeiling ? { hostRunCeiling } : {}),
        request: { ...request, command } satisfies SessionControlStartMutationRequest,
      }),
    )
    .with('follow-up', (command) =>
      queueSessionFollowUp({
        callerId,
        ...(authority ? { callerAuthorizationCeiling: authority.authorizationCeiling } : {}),
        request: { ...request, command } satisfies SessionControlFollowUpMutationRequest,
      }),
    )
    .with(
      'queue-withdraw',
      'queue-reorder',
      'queue-pause',
      'queue-resume',
      'queue-update-authorization',
      (command) =>
        mutateSessionQueue({
          callerId,
          ...(authority ? { callerAuthorizationCeiling: authority.authorizationCeiling } : {}),
          ...(hostRunCeiling ? { hostRunCeiling } : {}),
          request: {
            ...request,
            command:
              command.operation === 'queue-update-authorization' &&
              authority?.authorizationCeiling === 'ask-for-approval'
                ? { ...command, runAuthorizationOverride: 'ask-for-approval' as const }
                : command,
          } satisfies SessionControlQueueMutationRequest,
        }),
    )
    .exhaustive()
}

function executeActiveRunCommand(
  input: ExecuteCommandInput,
  command: Commands<
    | 'steer'
    | 'interrupt'
    | 'interrupt-descendants'
    | 'request-respond'
    | 'approval-respond'
    | 'authorization-set'
    | 'promote'
    | 'replace'
  >,
) {
  const { authority, callerId, request } = input
  return matchBy(command, 'operation')
    .with('steer', (command) =>
      steerSessionRun({
        callerId,
        request: { ...request, command } satisfies SessionControlSteerMutationRequest,
      }),
    )
    .with('interrupt', (command) =>
      interruptSessionRun({
        callerId,
        request: { ...request, command } satisfies SessionControlInterruptMutationRequest,
      }),
    )
    .with('interrupt-descendants', (command) =>
      interruptSessionDescendants({
        callerId,
        request: {
          ...request,
          command,
        } satisfies SessionControlInterruptDescendantsMutationRequest,
      }),
    )
    .with('request-respond', 'approval-respond', (command) =>
      respondToSessionInteraction({
        callerId,
        request: { ...request, command } satisfies SessionInteractionResponseMutationRequest,
      }),
    )
    .with('authorization-set', (command) =>
      setSessionAuthorization({
        callerId,
        request: { ...request, command } satisfies SessionAuthorizationSetMutationRequest,
      }),
    )
    .with('promote', (command) =>
      promoteSessionFollowUp({
        callerId,
        request: { ...request, command } satisfies SessionControlPromoteMutationRequest,
      }),
    )
    .with('replace', (command) =>
      replaceSessionRun({
        callerId,
        ...(authority ? { callerAuthorizationCeiling: authority.authorizationCeiling } : {}),
        request: { ...request, command } satisfies SessionControlReplaceMutationRequest,
      }),
    )
    .exhaustive()
}

export function executeUnserializedSessionControlCommand(
  input: ExecuteCommandInput,
): Effect.Effect<SessionControlMutationResponse, unknown, SessionControlCommandDependencies> {
  return matchBy(input.request.command, 'operation')
    .with(
      'message',
      'start',
      'follow-up',
      'queue-withdraw',
      'queue-reorder',
      'queue-pause',
      'queue-resume',
      'queue-update-authorization',
      (command) => executeRunOrQueueCommand(input, command),
    )
    .with(
      'steer',
      'interrupt',
      'interrupt-descendants',
      'request-respond',
      'approval-respond',
      'authorization-set',
      'promote',
      'replace',
      (command) => executeActiveRunCommand(input, command),
    )
    .with(
      'report',
      'export-create',
      'export-cancel',
      'rename',
      'archive',
      'unarchive',
      'handoff',
      'delegation-submit',
      'delegation-claim',
      'delegation-conflict-acknowledge',
      'delegation-dependency',
      'delegation-propose-amendment',
      'delegation-amend',
      'delegation-state',
      'delegation-request-revision',
      'delegation-accept',
      'delegation-reopen',
      'delegation-cancel',
      'delegation-verify',
      (command) => executeResourceSessionControlCommand(input, command),
    )
    .exhaustive()
}
