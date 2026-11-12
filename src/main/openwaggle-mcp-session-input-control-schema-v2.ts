import { hasUniqueCollaborationStructures } from '@shared/session-collaboration-collections'
import { SESSION_REPORT_REFERENCE_MAX_LENGTH } from '@shared/session-report-reference'
import {
  DELEGATION_CONFLICT_KINDS,
  DELEGATION_CONFLICT_STATUSES,
} from '@shared/types/session-delegation-query'
import { boundedArray, boundedString, check, enumeration, optional } from './json-schema-primitives'
import { mcpDelegationSpecificationSchemaV2 } from './openwaggle-mcp-delegation-specification-v2'
import { sessionClaimSchemaV2 } from './openwaggle-mcp-session-claim-schema-v2'
import {
  booleanFlag,
  boundedCursor,
  catalogScope,
  delegationStates,
  discoveryLimit,
  evidence,
  finiteUniqueEnumArray,
  followUpIds,
  idempotency,
  interactionTimeout,
  operationSchema,
  positiveRevision,
  revisedSpecificationSchema,
  revision,
  runAuthorization,
  targetSessionIds,
} from './openwaggle-mcp-session-input-schema-shared-v2'
import {
  MCP_SESSION_INPUT_LIMITS_V2,
  mcpSessionAttachmentPathsSchemaV2,
  mcpSessionIdSchemaV2,
  mcpSessionPathSchemaV2,
  mcpSessionTextSchemaV2,
} from './openwaggle-mcp-session-resource-envelope-v2'

/**
 * follow-up, steer, and replace act on an active Run or queue for one, so they never set the
 * Session thinking level or a Run authorization override. The keys are accepted here so the Host's
 * refusal reaches the caller with its code (`thinking_level_requires_idle_session`,
 * `run_authorization_override_requires_idle_session`) instead of a generic schema error.
 */
const refusedRunStartSettings = {
  thinking: optional(mcpSessionIdSchemaV2),
  ...runAuthorization,
}

export const mcpSessionControlOperationSchemasV2 = [
  operationSchema('message', {
    sessionId: optional(mcpSessionIdSchemaV2),
    message: optional(mcpSessionTextSchemaV2),
    attachmentPaths: optional(mcpSessionAttachmentPathsSchemaV2),
    thinking: optional(mcpSessionIdSchemaV2),
    ...runAuthorization,
    ...idempotency,
  }),
  operationSchema('start', {
    sessionId: optional(mcpSessionIdSchemaV2),
    message: optional(mcpSessionTextSchemaV2),
    attachmentPaths: optional(mcpSessionAttachmentPathsSchemaV2),
    thinking: optional(mcpSessionIdSchemaV2),
    ...runAuthorization,
    interactionTimeoutMs: optional(interactionTimeout),
    ...idempotency,
  }),
  operationSchema('follow-up', {
    sessionId: optional(mcpSessionIdSchemaV2),
    message: optional(mcpSessionTextSchemaV2),
    attachmentPaths: optional(mcpSessionAttachmentPathsSchemaV2),
    ...refusedRunStartSettings,
    ...idempotency,
  }),
  operationSchema('steer', {
    sessionId: optional(mcpSessionIdSchemaV2),
    expectedRunId: optional(mcpSessionIdSchemaV2),
    message: optional(mcpSessionTextSchemaV2),
    attachmentPaths: optional(mcpSessionAttachmentPathsSchemaV2),
    ...refusedRunStartSettings,
    ...idempotency,
  }),
  operationSchema('promote', {
    sessionId: optional(mcpSessionIdSchemaV2),
    expectedRunId: optional(mcpSessionIdSchemaV2),
    followUpId: optional(mcpSessionIdSchemaV2),
    ...idempotency,
  }),
  operationSchema('replace', {
    sessionId: optional(mcpSessionIdSchemaV2),
    expectedRunId: optional(mcpSessionIdSchemaV2),
    message: optional(mcpSessionTextSchemaV2),
    attachmentPaths: optional(mcpSessionAttachmentPathsSchemaV2),
    ...refusedRunStartSettings,
    ...idempotency,
  }),
  operationSchema('interrupt', {
    sessionId: optional(mcpSessionIdSchemaV2),
    expectedRunId: optional(mcpSessionIdSchemaV2),
    ...idempotency,
  }),
  operationSchema('interrupt-descendants', {
    sessionId: optional(mcpSessionIdSchemaV2),
    ...idempotency,
  }),
  operationSchema('report', {
    sessionId: optional(mcpSessionIdSchemaV2),
    sourceRunId: optional(mcpSessionIdSchemaV2),
    reportTarget: optional(
      enumeration('upstream', 'queen', 'session', 'sessions', 'worker-reference'),
    ),
    targetSessionIds: optional(targetSessionIds),
    workerReference: optional(boundedString({ min: 1, max: SESSION_REPORT_REFERENCE_MAX_LENGTH })),
    message: optional(mcpSessionTextSchemaV2),
    requestReply: optional(booleanFlag),
    replyToReportId: optional(mcpSessionIdSchemaV2),
    ...idempotency,
  }),
  operationSchema('delegation-submit', {
    sessionId: optional(mcpSessionIdSchemaV2),
    delegationId: optional(mcpSessionIdSchemaV2),
    submissionRevision: optional(positiveRevision),
    message: optional(mcpSessionTextSchemaV2),
    evidence: optional(evidence),
    ...idempotency,
  }),
  operationSchema('delegation-state', {
    sessionId: optional(mcpSessionIdSchemaV2),
    delegationId: optional(mcpSessionIdSchemaV2),
    delegationState: optional(enumeration('working', 'waiting', 'needs_attention')),
    reason: optional(mcpSessionTextSchemaV2),
    ...idempotency,
  }),
  operationSchema('delegation-claim', {
    sessionId: optional(mcpSessionIdSchemaV2),
    delegationId: optional(mcpSessionIdSchemaV2),
    reason: optional(mcpSessionTextSchemaV2),
    claims: optional(
      boundedArray(sessionClaimSchemaV2, MCP_SESSION_INPUT_LIMITS_V2.arrayItems).pipe(
        check(hasUniqueCollaborationStructures, 'Delegation claims must be unique.'),
      ),
    ),
    ...idempotency,
  }),
  operationSchema('delegation-conflict-acknowledge', {
    sessionId: optional(mcpSessionIdSchemaV2),
    delegationId: optional(mcpSessionIdSchemaV2),
    conflictId: optional(mcpSessionIdSchemaV2),
    reason: optional(mcpSessionTextSchemaV2),
    ...idempotency,
  }),
  operationSchema('delegation-dependency', {
    sessionId: optional(mcpSessionIdSchemaV2),
    delegationId: optional(mcpSessionIdSchemaV2),
    dependencyAction: optional(enumeration('add', 'remove')),
    dependencyDelegationId: optional(mcpSessionIdSchemaV2),
    dependencyRequiredState: optional(enumeration('ready_for_review', 'accepted')),
    reason: optional(mcpSessionTextSchemaV2),
    ...idempotency,
  }),
  operationSchema('delegation-propose-amendment', {
    sessionId: optional(mcpSessionIdSchemaV2),
    delegationId: optional(mcpSessionIdSchemaV2),
    specificationRevision: optional(positiveRevision),
    delegationSpecification: optional(mcpDelegationSpecificationSchemaV2),
    reason: optional(mcpSessionTextSchemaV2),
    ...idempotency,
  }),
  operationSchema('delegation-amend', {
    sessionId: optional(mcpSessionIdSchemaV2),
    delegationId: optional(mcpSessionIdSchemaV2),
    specificationRevision: optional(positiveRevision),
    delegationSpecification: optional(mcpDelegationSpecificationSchemaV2),
    proposalId: optional(mcpSessionIdSchemaV2),
    reason: optional(mcpSessionTextSchemaV2),
    ...idempotency,
  }),
  operationSchema('delegation-request-revision', {
    sessionId: optional(mcpSessionIdSchemaV2),
    delegationId: optional(mcpSessionIdSchemaV2),
    submissionRevision: optional(positiveRevision),
    feedback: optional(mcpSessionTextSchemaV2),
    revisedSpecification: optional(revisedSpecificationSchema),
    ...idempotency,
  }),
  operationSchema('delegation-accept', {
    sessionId: optional(mcpSessionIdSchemaV2),
    delegationId: optional(mcpSessionIdSchemaV2),
    submissionRevision: optional(positiveRevision),
    message: optional(mcpSessionTextSchemaV2),
    ...idempotency,
  }),
  operationSchema('delegation-reopen', {
    sessionId: optional(mcpSessionIdSchemaV2),
    delegationId: optional(mcpSessionIdSchemaV2),
    reason: optional(mcpSessionTextSchemaV2),
    ...idempotency,
  }),
  operationSchema('delegation-cancel', {
    sessionId: optional(mcpSessionIdSchemaV2),
    delegationId: optional(mcpSessionIdSchemaV2),
    reason: optional(mcpSessionTextSchemaV2),
    ...idempotency,
  }),
  operationSchema('delegation-verify', {
    sessionId: optional(mcpSessionIdSchemaV2),
    delegationId: optional(mcpSessionIdSchemaV2),
    submissionRevision: optional(positiveRevision),
    verificationOutcome: optional(enumeration('passed', 'failed', 'inconclusive')),
    message: optional(mcpSessionTextSchemaV2),
    evidence: optional(evidence),
    ...idempotency,
  }),
  operationSchema('delegations-list', {
    projectPath: optional(mcpSessionPathSchemaV2),
    catalogScope: optional(catalogScope),
    parentSessionId: optional(mcpSessionIdSchemaV2),
    workerSessionId: optional(mcpSessionIdSchemaV2),
    states: optional(delegationStates),
    limit: optional(discoveryLimit),
    cursor: optional(boundedCursor),
  }),
  operationSchema('delegations-read', {
    delegationId: optional(mcpSessionIdSchemaV2),
    limit: optional(discoveryLimit),
    cursor: optional(boundedCursor),
  }),
  operationSchema('delegations-conflicts', {
    projectPath: optional(mcpSessionPathSchemaV2),
    catalogScope: optional(catalogScope),
    parentSessionId: optional(mcpSessionIdSchemaV2),
    workerSessionId: optional(mcpSessionIdSchemaV2),
    delegationId: optional(mcpSessionIdSchemaV2),
    conflictKinds: optional(finiteUniqueEnumArray(DELEGATION_CONFLICT_KINDS)),
    conflictStatuses: optional(finiteUniqueEnumArray(DELEGATION_CONFLICT_STATUSES)),
    limit: optional(discoveryLimit),
    cursor: optional(boundedCursor),
  }),
  operationSchema('queue-list', {
    sessionId: optional(mcpSessionIdSchemaV2),
    includeBodies: optional(booleanFlag),
  }),
  operationSchema('queue-withdraw', {
    sessionId: optional(mcpSessionIdSchemaV2),
    followUpIds: optional(followUpIds),
    ...idempotency,
  }),
  operationSchema('queue-reorder', {
    sessionId: optional(mcpSessionIdSchemaV2),
    followUpIds: optional(followUpIds),
    queueRevision: optional(revision),
    ...idempotency,
  }),
  operationSchema('queue-pause', {
    sessionId: optional(mcpSessionIdSchemaV2),
    queueRevision: optional(revision),
    ...idempotency,
  }),
  operationSchema('queue-resume', {
    sessionId: optional(mcpSessionIdSchemaV2),
    queueRevision: optional(revision),
    ...idempotency,
  }),
] as const
