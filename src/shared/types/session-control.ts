import type { SchemaType } from '@shared/schema'
import type {
  sessionControlMutationCommandSchema,
  sessionControlMutationRequestSchema,
} from '@shared/schemas/session-control'
import type {
  sessionControlMutationOutcomeSchema,
  steeringReceiptSchema,
} from '@shared/schemas/session-control-outcomes'

export type {
  SessionAuthorizationSetCommand,
  SessionAuthorizationUpdatedOutcome,
} from './session-authorization-control'
export type {
  SessionControlDelegationDependencyCommand,
  SessionControlDelegationSubmitCommand,
} from './session-collaboration'
export type {
  SessionControlInterruptCommand,
  SessionControlInterruptDescendantsCommand,
} from './session-control-interruption'
export type {
  SessionControlQueueAdoptCommand,
  SessionControlQueueEditBeginCommand,
  SessionControlQueueEditCancelCommand,
  SessionControlQueueEditSaveCommand,
  SessionControlQueuePauseCommand,
  SessionControlQueueReorderCommand,
  SessionControlQueueResumeCommand,
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
  SessionControlQueueAdoptMutationRequest,
  SessionControlQueueEditMutationRequest,
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
} from './session-control-run-commands'
export type {
  SessionInteractionResolvedOutcome,
  SessionInteractionResponseCommand,
} from './session-interaction-control'

export const SESSION_CONTROL_CONTRACT_VERSION = 2 as const

export type SessionControlSteeringReceipt = SchemaType<typeof steeringReceiptSchema>

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
  'queue-adopt',
  'queue-edit-begin',
  'queue-edit-cancel',
  'queue-edit-save',
  'queue-pause',
  'queue-reorder',
  'queue-resume',
  'queue-withdraw',
  'report',
  'replace',
  'start',
  'steer',
] as const

export type SessionControlMutationCommand = SchemaType<typeof sessionControlMutationCommandSchema>

export type SessionControlMutationRequest = SchemaType<typeof sessionControlMutationRequestSchema>

export type SessionControlMutationOutcome = SchemaType<typeof sessionControlMutationOutcomeSchema>
