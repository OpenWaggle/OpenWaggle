import type { SessionAuthorizationSetCommand } from './session-authorization-control'
import type {
  SessionControlDelegationAcceptCommand,
  SessionControlDelegationAmendCommand,
  SessionControlDelegationCancelCommand,
  SessionControlDelegationClaimCommand,
  SessionControlDelegationConflictAcknowledgeCommand,
  SessionControlDelegationDependencyCommand,
  SessionControlDelegationProposeAmendmentCommand,
  SessionControlDelegationReopenCommand,
  SessionControlDelegationRequestRevisionCommand,
  SessionControlDelegationStateCommand,
  SessionControlDelegationSubmitCommand,
  SessionControlDelegationVerifyCommand,
  SessionControlReportCommand,
} from './session-collaboration'
import type { SessionControlMutationRequest } from './session-control'
import type {
  SessionControlInterruptCommand,
  SessionControlInterruptDescendantsCommand,
} from './session-control-interruption'
import type { SessionControlQueueMutationCommand } from './session-control-queue'
import type {
  SessionControlFollowUpCommand,
  SessionControlMessageCommand,
  SessionControlPromoteCommand,
  SessionControlReplaceCommand,
  SessionControlStartCommand,
  SessionControlSteerCommand,
} from './session-control-run-commands'
import type {
  SessionExportCancelCommand,
  SessionExportCreateCommand,
} from './session-export-operation'
import type { SessionInteractionResponseCommand } from './session-interaction-control'

type MutationRequestFor<Command> = Omit<SessionControlMutationRequest, 'command'> & {
  readonly command: Command
}

export type SessionControlMessageMutationRequest = MutationRequestFor<SessionControlMessageCommand>
export type SessionControlFollowUpMutationRequest =
  MutationRequestFor<SessionControlFollowUpCommand>
export type SessionControlStartMutationRequest = MutationRequestFor<SessionControlStartCommand>
export type SessionControlSteerMutationRequest = MutationRequestFor<SessionControlSteerCommand>
export type SessionControlInterruptMutationRequest =
  MutationRequestFor<SessionControlInterruptCommand>
export type SessionControlInterruptDescendantsMutationRequest =
  MutationRequestFor<SessionControlInterruptDescendantsCommand>
export type SessionInteractionResponseMutationRequest =
  MutationRequestFor<SessionInteractionResponseCommand>
export type SessionAuthorizationSetMutationRequest =
  MutationRequestFor<SessionAuthorizationSetCommand>
export type SessionControlPromoteMutationRequest = MutationRequestFor<SessionControlPromoteCommand>
export type SessionControlReportMutationRequest = MutationRequestFor<SessionControlReportCommand>
export type SessionControlDelegationMutationRequest = MutationRequestFor<
  | SessionControlDelegationAcceptCommand
  | SessionControlDelegationCancelCommand
  | SessionControlDelegationClaimCommand
  | SessionControlDelegationConflictAcknowledgeCommand
  | SessionControlDelegationDependencyCommand
  | SessionControlDelegationProposeAmendmentCommand
  | SessionControlDelegationAmendCommand
  | SessionControlDelegationReopenCommand
  | SessionControlDelegationRequestRevisionCommand
  | SessionControlDelegationStateCommand
  | SessionControlDelegationSubmitCommand
  | SessionControlDelegationVerifyCommand
>
export type SessionControlReplaceMutationRequest = MutationRequestFor<SessionControlReplaceCommand>
export type SessionControlQueueMutationRequest =
  MutationRequestFor<SessionControlQueueMutationCommand>
export type SessionExportCreateMutationRequest = MutationRequestFor<SessionExportCreateCommand>
export type SessionExportCancelMutationRequest = MutationRequestFor<SessionExportCancelCommand>
