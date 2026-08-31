import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationCommand,
} from '@shared/types/session-control'
import type { SessionsToolParameters } from './sessions-tool-parameters'
import type { SessionsToolSource } from './sessions-tool-payload'

export type SessionsToolCollaborationParameters = Extract<
  SessionsToolParameters,
  {
    action:
      | 'report'
      | 'delegation_submit'
      | 'delegation_state'
      | 'delegation_claim'
      | 'delegation_conflict_acknowledge'
      | 'delegation_dependency'
      | 'delegation_propose_amendment'
      | 'delegation_amend'
      | 'delegation_request_revision'
      | 'delegation_accept'
      | 'delegation_reopen'
      | 'delegation_cancel'
      | 'delegation_verify'
  }
>

const COLLABORATION_ACTIONS = new Set<SessionsToolParameters['action']>([
  'report',
  'delegation_submit',
  'delegation_state',
  'delegation_claim',
  'delegation_conflict_acknowledge',
  'delegation_dependency',
  'delegation_propose_amendment',
  'delegation_amend',
  'delegation_request_revision',
  'delegation_accept',
  'delegation_reopen',
  'delegation_cancel',
  'delegation_verify',
])

export function isSessionsToolCollaborationAction(
  input: SessionsToolParameters,
): input is SessionsToolCollaborationParameters {
  return COLLABORATION_ACTIONS.has(input.action)
}

function reportPayload(
  input: Extract<SessionsToolParameters, { action: 'report' }>,
  source: SessionsToolSource,
): LocalSessionCommandPayload {
  const target =
    input.target.type === 'worker_reference'
      ? { type: 'worker-reference' as const, reference: input.target.reference }
      : input.target
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      command: {
        operation: 'report',
        sessionId: source.sessionId,
        sourceRunId: source.runId,
        target,
        input: {
          text: input.text,
          requestReply: input.requestReply ?? false,
          ...(input.replyToReportId ? { replyToReportId: input.replyToReportId } : {}),
        },
      },
    },
  }
}

type DelegationInput = Exclude<SessionsToolCollaborationParameters, { action: 'report' }>
type ReviewInput = Extract<
  DelegationInput,
  {
    action:
      | 'delegation_request_revision'
      | 'delegation_verify'
      | 'delegation_accept'
      | 'delegation_reopen'
      | 'delegation_cancel'
  }
>

function isReviewInput(input: DelegationInput): input is ReviewInput {
  return [
    'delegation_request_revision',
    'delegation_verify',
    'delegation_accept',
    'delegation_reopen',
    'delegation_cancel',
  ].includes(input.action)
}

function reviewCommand(
  input: ReviewInput,
  source: SessionsToolSource,
): SessionControlMutationCommand {
  if (input.action === 'delegation_request_revision') {
    return {
      operation: 'delegation-request-revision',
      sessionId: source.sessionId,
      delegationId: input.delegationId,
      submissionRevision: input.submissionRevision,
      feedback: input.feedback,
      ...(input.revisedSpecification ? { revisedSpecification: input.revisedSpecification } : {}),
    }
  }
  if (input.action === 'delegation_verify') {
    return {
      operation: 'delegation-verify',
      sessionId: source.sessionId,
      delegationId: input.delegationId,
      submissionRevision: input.submissionRevision,
      outcome: input.outcome,
      summary: input.summary,
      evidence: input.evidence ?? [],
    }
  }
  if (input.action === 'delegation_accept') {
    return {
      operation: 'delegation-accept',
      sessionId: source.sessionId,
      delegationId: input.delegationId,
      submissionRevision: input.submissionRevision,
      ...(input.note ? { note: input.note } : {}),
    }
  }
  return {
    operation: input.action === 'delegation_reopen' ? 'delegation-reopen' : 'delegation-cancel',
    sessionId: source.sessionId,
    delegationId: input.delegationId,
    reason: input.reason,
  }
}

function delegationPayload(
  input: DelegationInput,
  source: SessionsToolSource,
): LocalSessionCommandPayload {
  const command: SessionControlMutationCommand = isReviewInput(input)
    ? reviewCommand(input, source)
    : input.action === 'delegation_submit'
      ? {
          operation: 'delegation-submit',
          sessionId: source.sessionId,
          delegationId: input.delegationId,
          summary: input.summary,
          evidence: input.evidence ?? [],
        }
      : input.action === 'delegation_state'
        ? {
            operation: 'delegation-state',
            sessionId: source.sessionId,
            delegationId: input.delegationId,
            state: input.state,
            reason: input.reason,
          }
        : input.action === 'delegation_claim'
          ? {
              operation: 'delegation-claim',
              sessionId: source.sessionId,
              delegationId: input.delegationId,
              claims: input.claims,
              reason: input.reason,
            }
          : input.action === 'delegation_conflict_acknowledge'
            ? {
                operation: 'delegation-conflict-acknowledge',
                sessionId: source.sessionId,
                delegationId: input.delegationId,
                conflictId: input.conflictId,
                reason: input.reason,
              }
            : input.action === 'delegation_dependency'
              ? {
                  operation: 'delegation-dependency',
                  sessionId: source.sessionId,
                  delegationId: input.delegationId,
                  action: input.dependencyAction,
                  dependencyDelegationId: input.dependencyDelegationId,
                  requiredState: input.requiredState,
                  reason: input.reason,
                }
              : input.action === 'delegation_propose_amendment'
                ? {
                    operation: 'delegation-propose-amendment',
                    sessionId: source.sessionId,
                    delegationId: input.delegationId,
                    baseSpecificationRevision: input.baseSpecificationRevision,
                    specification: input.specification,
                    reason: input.reason,
                  }
                : {
                    operation: 'delegation-amend',
                    sessionId: source.sessionId,
                    delegationId: input.delegationId,
                    expectedSpecificationRevision: input.expectedSpecificationRevision,
                    specification: input.specification,
                    reason: input.reason,
                    ...(input.proposalId ? { proposalId: input.proposalId } : {}),
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

export function buildSessionsToolCollaborationPayload(
  input: SessionsToolCollaborationParameters,
  source: SessionsToolSource,
) {
  return input.action === 'report' ? reportPayload(input, source) : delegationPayload(input, source)
}
