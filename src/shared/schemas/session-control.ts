import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import {
  delegationAcceptCommandSchema,
  delegationAmendCommandSchema,
  delegationCancelCommandSchema,
  delegationClaimCommandSchema,
  delegationConflictAcknowledgeCommandSchema,
  delegationDependencyCommandSchema,
  delegationProposeAmendmentCommandSchema,
  delegationReopenCommandSchema,
  delegationRequestRevisionCommandSchema,
  delegationStateCommandSchema,
  delegationSubmitCommandSchema,
  delegationVerifyCommandSchema,
  reportCommandSchema,
} from './session-collaboration-control'
import {
  authorizationSetCommandSchema,
  followUpCommandSchema,
  followUpEditHoldReferenceSchema,
  interactionResponseCommandSchema,
  interruptCommandSchema,
  interruptDescendantsCommandSchema,
  messageCommandSchema,
  promoteCommandSchema,
  queueAdoptCommandSchema,
  queueEditBeginCommandSchema,
  queueEditCancelCommandSchema,
  queueEditSaveCommandSchema,
  queuePauseCommandSchema,
  queueReorderCommandSchema,
  queueResumeCommandSchema,
  queueWithdrawCommandSchema,
  replaceCommandSchema,
  startCommandSchema,
  steerCommandSchema,
} from './session-control-commands'
import { sessionControlMutationOutcomeSchema } from './session-control-outcomes'
import { exportCancelCommandSchema, exportCreateCommandSchema } from './session-export-operation'
import { sessionInputIdSchema } from './session-input'
import { sessionOrganizationCommandSchemas } from './session-organization'

export { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'

export const sessionControlMutationCommandSchema = Schema.Union(
  delegationAcceptCommandSchema,
  delegationCancelCommandSchema,
  delegationClaimCommandSchema,
  delegationConflictAcknowledgeCommandSchema,
  delegationDependencyCommandSchema,
  delegationProposeAmendmentCommandSchema,
  delegationAmendCommandSchema,
  delegationReopenCommandSchema,
  delegationRequestRevisionCommandSchema,
  delegationStateCommandSchema,
  delegationSubmitCommandSchema,
  delegationVerifyCommandSchema,
  exportCancelCommandSchema,
  exportCreateCommandSchema,
  followUpCommandSchema,
  interruptCommandSchema,
  interruptDescendantsCommandSchema,
  authorizationSetCommandSchema,
  interactionResponseCommandSchema,
  messageCommandSchema,
  ...sessionOrganizationCommandSchemas,
  promoteCommandSchema,
  queueAdoptCommandSchema,
  queueEditBeginCommandSchema,
  queueEditCancelCommandSchema,
  queueEditSaveCommandSchema,
  queuePauseCommandSchema,
  queueReorderCommandSchema,
  queueResumeCommandSchema,
  queueWithdrawCommandSchema,
  reportCommandSchema,
  replaceCommandSchema,
  startCommandSchema,
  steerCommandSchema,
)

export const sessionControlMutationRequestSchema = Schema.Struct({
  contractVersion: Schema.Literal(SESSION_CONTROL_CONTRACT_VERSION),
  requestId: sessionInputIdSchema,
  idempotencyKey: sessionInputIdSchema,
  command: sessionControlMutationCommandSchema,
})

export const sessionControlMutationResponseSchema = Schema.Struct({
  contractVersion: Schema.Literal(SESSION_CONTROL_CONTRACT_VERSION),
  requestId: Schema.String,
  idempotencyKey: Schema.String,
  replayed: Schema.Boolean,
  outcome: sessionControlMutationOutcomeSchema,
})

export function decodeSessionControlMutationRequest(value: unknown) {
  return decodeUnknownExactOrThrow(sessionControlMutationRequestSchema, value)
}

export function decodeSessionControlMutationResponse(value: unknown) {
  return decodeUnknownExactOrThrow(sessionControlMutationResponseSchema, value)
}

export function decodeSessionControlMutationOutcome(value: unknown) {
  return decodeUnknownExactOrThrow(sessionControlMutationOutcomeSchema, value)
}

/** A Follow-up edit hold a desktop window names, e.g. to adopt it (ADR 0044). */
export function decodeFollowUpEditHoldReference(value: unknown) {
  return decodeUnknownExactOrThrow(followUpEditHoldReferenceSchema, value)
}
