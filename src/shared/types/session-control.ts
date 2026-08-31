import type {
  SessionAuthorizationSetCommand,
  SessionAuthorizationUpdatedOutcome,
} from './session-authorization-control'
import type {
  SessionControlCollaborationCommand,
  SessionControlCollaborationOutcome,
} from './session-collaboration'
import type {
  SessionControlDescendantInterruptionOutcome,
  SessionControlInterruptCommand,
  SessionControlInterruptDescendantsCommand,
} from './session-control-interruption'
import type {
  SessionControlQueueMutationCommand,
  SessionControlQueuePauseCommand,
  SessionControlQueueReorderCommand,
  SessionControlQueueResumeCommand,
  SessionControlQueueUpdateAuthorizationCommand,
  SessionControlQueueWithdrawCommand,
} from './session-control-queue'
import type {
  SessionControlFollowUpCommand,
  SessionControlMessageCommand,
  SessionControlPromoteCommand,
  SessionControlReplaceCommand,
  SessionControlStartCommand,
  SessionControlSteerCommand,
} from './session-control-run-commands'
import type {
  SessionExportControlCommand,
  SessionExportControlOutcome,
} from './session-export-operation'
import type {
  SessionInteractionResolvedOutcome,
  SessionInteractionResponseCommand,
} from './session-interaction-control'
import type { SessionOrganizationCommand, SessionOrganizationOutcome } from './session-organization'

export type {
  SessionAuthorizationSetCommand,
  SessionAuthorizationUpdatedOutcome,
} from './session-authorization-control'
export type {
  DelegationEvidenceInput,
  DelegationEvidenceKind,
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
  SessionControlReportTarget,
} from './session-collaboration'
export type {
  SessionControlInterruptCommand,
  SessionControlInterruptDescendantsCommand,
} from './session-control-interruption'
export type {
  SessionControlQueueMutationCommand,
  SessionControlQueuePauseCommand,
  SessionControlQueueReorderCommand,
  SessionControlQueueResumeCommand,
  SessionControlQueueUpdateAuthorizationCommand,
  SessionControlQueueWithdrawCommand,
} from './session-control-queue'
export type {
  SessionAuthorizationSetMutationRequest,
  SessionControlDelegationMutationRequest,
  SessionControlFollowUpMutationRequest,
  SessionControlInterruptDescendantsMutationRequest,
  SessionControlInterruptMutationRequest,
  SessionControlMessageMutationRequest,
  SessionControlPromoteMutationRequest,
  SessionControlQueueMutationRequest,
  SessionControlReplaceMutationRequest,
  SessionControlReportMutationRequest,
  SessionControlStartMutationRequest,
  SessionControlSteerMutationRequest,
  SessionExportCancelMutationRequest,
  SessionExportCreateMutationRequest,
  SessionInteractionResponseMutationRequest,
} from './session-control-requests'
export type { SessionControlMutationResponse } from './session-control-response'
export type {
  SessionControlFollowUpCommand,
  SessionControlMessageCommand,
  SessionControlMessageInput,
  SessionControlPromoteCommand,
  SessionControlReplaceCommand,
  SessionControlStartCommand,
  SessionControlSteerCommand,
  SessionControlSteeringInput,
} from './session-control-run-commands'
export type {
  SessionExportCancelCommand,
  SessionExportCreateCommand,
} from './session-export-operation'
export type {
  SessionInteractionResolvedOutcome,
  SessionInteractionResponseCommand,
} from './session-interaction-control'

export const SESSION_CONTROL_CONTRACT_VERSION = 2 as const

export const SESSION_CONTROL_MUTATION_OPERATIONS = [
  'follow-up',
  'delegation-accept',
  'delegation-cancel',
  'delegation-claim',
  'delegation-conflict-acknowledge',
  'delegation-dependency',
  'delegation-propose-amendment',
  'delegation-amend',
  'delegation-reopen',
  'delegation-request-revision',
  'delegation-state',
  'delegation-submit',
  'delegation-verify',
  'export-cancel',
  'export-create',
  'interrupt',
  'interrupt-descendants',
  'authorization-set',
  'request-respond',
  'approval-respond',
  'message',
  'rename',
  'archive',
  'unarchive',
  'handoff',
  'promote',
  'queue-pause',
  'queue-reorder',
  'queue-resume',
  'queue-update-authorization',
  'queue-withdraw',
  'report',
  'replace',
  'start',
  'steer',
] as const

export type SessionControlMutationCommand =
  | SessionControlCollaborationCommand
  | SessionExportControlCommand
  | SessionControlFollowUpCommand
  | SessionControlInterruptCommand
  | SessionControlInterruptDescendantsCommand
  | SessionControlMessageCommand
  | SessionInteractionResponseCommand
  | SessionAuthorizationSetCommand
  | SessionOrganizationCommand
  | SessionControlPromoteCommand
  | SessionControlQueuePauseCommand
  | SessionControlQueueReorderCommand
  | SessionControlQueueResumeCommand
  | SessionControlQueueUpdateAuthorizationCommand
  | SessionControlQueueWithdrawCommand
  | SessionControlReplaceCommand
  | SessionControlStartCommand
  | SessionControlSteerCommand

export interface SessionControlMutationRequest {
  readonly contractVersion: typeof SESSION_CONTROL_CONTRACT_VERSION
  readonly requestId: string
  readonly idempotencyKey: string
  readonly command: SessionControlMutationCommand
}

export type SessionControlMutationOutcome =
  | SessionControlCollaborationOutcome
  | SessionExportControlOutcome
  | SessionOrganizationOutcome
  | SessionInteractionResolvedOutcome
  | SessionAuthorizationUpdatedOutcome
  | {
      readonly operation: 'follow-up'
      readonly effect: 'queued-follow-up'
      readonly sessionId: string
      readonly followUpId: string
      readonly queueRevision: number
      readonly stateRevision: number
    }
  | {
      readonly operation: 'message'
      readonly effect: 'started-run'
      readonly sessionId: string
      readonly runId: string
      readonly stateRevision: number
    }
  | {
      readonly operation: 'start'
      readonly effect: 'started-run'
      readonly sessionId: string
      readonly runId: string
      readonly stateRevision: number
    }
  | {
      readonly operation: 'steer'
      readonly effect: 'steered-run'
      readonly sessionId: string
      readonly runId: string
      readonly stateRevision: number
    }
  | {
      readonly operation: 'interrupt'
      readonly effect: 'interruption-requested'
      readonly sessionId: string
      readonly runId: string
      readonly stateRevision: number
    }
  | SessionControlDescendantInterruptionOutcome
  | {
      readonly operation: 'promote'
      readonly effect: 'promoted-follow-up'
      readonly sessionId: string
      readonly runId: string
      readonly followUpId: string
      readonly queueRevision: number
      readonly stateRevision: number
    }
  | {
      readonly operation: 'replace'
      readonly effect: 'replaced-run'
      readonly sessionId: string
      readonly interruptedRunId: string
      readonly runId: string
      readonly stateRevision: number
    }
  | {
      readonly operation: SessionControlQueueMutationCommand['operation']
      readonly effect: 'queue-updated'
      readonly sessionId: string
      readonly queueState: 'running' | 'paused'
      readonly queueRevision: number
      readonly followUpIds: readonly string[]
      readonly stateRevision: number
    }
  | {
      readonly operation: 'queue-resume'
      readonly effect: 'started-run'
      readonly sessionId: string
      readonly runId: string
      readonly followUpId: string
      readonly queueRevision: number
      readonly stateRevision: number
    }
  | {
      readonly operation: 'message'
      readonly effect: 'queued-follow-up'
      readonly sessionId: string
      readonly followUpId: string
      readonly queueRevision: number
      readonly stateRevision: number
    }
  | {
      readonly operation: SessionControlMutationCommand['operation']
      readonly effect: 'rejected'
      readonly sessionId: string
      readonly code: string
    }
