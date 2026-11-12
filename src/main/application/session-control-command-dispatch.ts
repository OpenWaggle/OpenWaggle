import { matchBy } from '@diegogbrisa/ts-match'
import type {
  LocalSessionCallerIdentity,
  LocalSessionProfileAuthority,
} from '@shared/types/local-session-profile'
import type {
  SessionAuthorizationSetMutationRequest,
  SessionControlFollowUpMutationRequest,
  SessionControlInterruptDescendantsMutationRequest,
  SessionControlInterruptMutationRequest,
  SessionControlMessageMutationRequest,
  SessionControlMutationRequest,
  SessionControlMutationResponse,
  SessionControlPromoteMutationRequest,
  SessionControlQueueAdoptMutationRequest,
  SessionControlQueueEditMutationRequest,
  SessionControlQueueMutationRequest,
  SessionControlReplaceMutationRequest,
  SessionControlStartMutationRequest,
  SessionControlSteerMutationRequest,
  SessionInteractionResponseMutationRequest,
} from '@shared/types/session-control'
import type * as Effect from 'effect/Effect'
import { setSessionAuthorization } from './session-authorization-service'
import type { SessionControlCommandDependencies } from './session-control-command-dependencies'
import {
  interruptSessionDescendants,
  interruptSessionRun,
} from './session-control-external-service'
import { promoteSessionFollowUp } from './session-control-promotion-service'
import { adoptSessionFollowUp } from './session-control-queue-adopt-service'
import { editSessionFollowUp, FOLLOW_UP_EDIT_CALLER_ID } from './session-control-queue-edit-service'
import { replaceSessionRun } from './session-control-replacement-service'
import { executeResourceSessionControlCommand } from './session-control-resource-command-dispatch'
import {
  mutateSessionQueue,
  queueSessionFollowUp,
  startSessionRun,
  submitSessionMessage,
} from './session-control-service'
import { steerSessionRun } from './session-control-steering-service'
import { respondToSessionInteraction } from './session-interaction-service'

interface ExecuteCommandInput {
  readonly callerId: string
  readonly caller?: LocalSessionCallerIdentity
  readonly request: SessionControlMutationRequest
  readonly authority?: LocalSessionProfileAuthority
  readonly hostRunCeiling?: number
  /** False while the Host drains: queue changes apply but do not start the next Follow-up. */
  readonly queueDeliveryAdmitted?: boolean
  /** A `start` the Host sends to wake an idle parent (`hive-parent-wake.ts`). */
  readonly hiveWake?: true
}

export type { SessionControlCommandDependencies }

type Command = SessionControlMutationRequest['command']
type Commands<Operation extends Command['operation']> = Extract<
  Command,
  { readonly operation: Operation }
>

/** The desktop user without a profile: the only caller that may edit or adopt a Follow-up. */
function isDesktopUserCaller(input: ExecuteCommandInput) {
  return (
    input.callerId === FOLLOW_UP_EDIT_CALLER_ID &&
    input.authority === undefined &&
    input.caller?.profileAuthority === undefined
  )
}

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
    | 'queue-adopt'
    | 'queue-edit-begin'
    | 'queue-edit-save'
    | 'queue-edit-cancel'
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
        ...(input.hiveWake ? { hiveWake: true } : {}),
        request: { ...request, command } satisfies SessionControlStartMutationRequest,
      }),
    )
    .with('follow-up', (command) =>
      queueSessionFollowUp({
        callerId,
        ...(authority ? { callerAuthorizationCeiling: authority.authorizationCeiling } : {}),
        ...(hostRunCeiling ? { hostRunCeiling } : {}),
        request: { ...request, command } satisfies SessionControlFollowUpMutationRequest,
      }),
    )
    .with('queue-withdraw', 'queue-reorder', 'queue-pause', 'queue-resume', (command) =>
      mutateSessionQueue({
        callerId,
        ...(authority ? { callerAuthorizationCeiling: authority.authorizationCeiling } : {}),
        ...(hostRunCeiling ? { hostRunCeiling } : {}),
        ...(input.queueDeliveryAdmitted === false ? { queueDeliveryAdmitted: false } : {}),
        request: { ...request, command } satisfies SessionControlQueueMutationRequest,
      }),
    )
    .with('queue-adopt', (command) =>
      adoptSessionFollowUp({
        callerId,
        desktopUser: isDesktopUserCaller(input),
        ...(hostRunCeiling ? { hostRunCeiling } : {}),
        ...(input.queueDeliveryAdmitted === false ? { queueDeliveryAdmitted: false } : {}),
        request: { ...request, command } satisfies SessionControlQueueAdoptMutationRequest,
      }),
    )
    .with('queue-edit-begin', 'queue-edit-save', 'queue-edit-cancel', (command) =>
      editSessionFollowUp({
        callerId,
        desktopUser: isDesktopUserCaller(input),
        ...(hostRunCeiling ? { hostRunCeiling } : {}),
        ...(input.queueDeliveryAdmitted === false ? { queueDeliveryAdmitted: false } : {}),
        request: { ...request, command } satisfies SessionControlQueueEditMutationRequest,
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
        ...(input.caller ? { caller: input.caller } : {}),
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

export function executeUnserializedSessionControlCommand(input: ExecuteCommandInput) {
  const effect: Effect.Effect<
    SessionControlMutationResponse,
    unknown,
    SessionControlCommandDependencies
  > = matchBy(input.request.command, 'operation')
    .with(
      'message',
      'start',
      'follow-up',
      'queue-withdraw',
      'queue-reorder',
      'queue-pause',
      'queue-resume',
      'queue-adopt',
      'queue-edit-begin',
      'queue-edit-save',
      'queue-edit-cancel',
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
  return effect
}
