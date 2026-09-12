import type { SessionControlMutationCommand } from '@shared/types/session-control'
import { option, type ParsedArguments } from './mcp-cli-arguments'
import { positiveInteger, required } from './sessions-cli-arguments'
import {
  delegationClaims,
  delegationEvidence,
  delegationSpecification,
} from './sessions-cli-delegation-input'

const CONTENT_START = 4
const SESSION_POSITION = 1
const DELEGATION_POSITION = 2
const REVISION_POSITION = 3
const DEPENDENCY_ID_POSITION = 4
const DEPENDENCY_STATE_POSITION = 5
const DEPENDENCY_REASON_POSITION = 6
const VERIFICATION_OUTCOME_POSITION = 4
const VERIFICATION_SUMMARY_POSITION = 5

function stateCommand(
  arguments_: ParsedArguments,
  sessionId: string,
  delegationId: string,
): SessionControlMutationCommand {
  const state = arguments_.positionals[REVISION_POSITION]
  if (state !== 'working' && state !== 'waiting' && state !== 'needs_attention') {
    throw new Error('Delegation state must be working, waiting, or needs_attention.')
  }
  return {
    operation: 'delegation-state',
    sessionId,
    delegationId,
    state,
    reason: required(arguments_.positionals.slice(CONTENT_START).join(' '), 'Transition reason'),
  }
}

function contributionCommand(
  action: string,
  arguments_: ParsedArguments,
  sessionId: string,
  delegationId: string,
) {
  if (action === 'state') return stateCommand(arguments_, sessionId, delegationId)
  if (action !== 'claim') return undefined
  return {
    operation: 'delegation-claim' as const,
    sessionId,
    delegationId,
    claims: delegationClaims(arguments_),
    reason: required(arguments_.positionals.slice(REVISION_POSITION).join(' '), 'Claim reason'),
  }
}

function dependencyCommand(
  arguments_: ParsedArguments,
  sessionId: string,
  delegationId: string,
): SessionControlMutationCommand {
  const action = arguments_.positionals[REVISION_POSITION]
  if (action !== 'add' && action !== 'remove') {
    throw new Error('Delegation dependency action must be add or remove.')
  }
  const requiredState = arguments_.positionals[DEPENDENCY_STATE_POSITION]
  if (requiredState !== 'ready_for_review' && requiredState !== 'accepted') {
    throw new Error('Delegation dependency state must be ready_for_review or accepted.')
  }
  return {
    operation: 'delegation-dependency',
    sessionId,
    delegationId,
    action,
    dependencyDelegationId: required(
      arguments_.positionals[DEPENDENCY_ID_POSITION],
      'Dependency Delegation ID',
    ),
    requiredState,
    reason: required(
      arguments_.positionals.slice(DEPENDENCY_REASON_POSITION).join(' '),
      'Dependency reason',
    ),
  }
}

function nonReviewCommand(
  action: string,
  arguments_: ParsedArguments,
  sessionId: string,
  delegationId: string,
) {
  const contribution = contributionCommand(action, arguments_, sessionId, delegationId)
  if (contribution) return contribution
  if (action === 'dependency') return dependencyCommand(arguments_, sessionId, delegationId)
  if (action === 'acknowledge-conflict') {
    return {
      operation: 'delegation-conflict-acknowledge' as const,
      sessionId,
      delegationId,
      conflictId: required(arguments_.positionals[REVISION_POSITION], 'Conflict ID'),
      reason: required(
        arguments_.positionals.slice(CONTENT_START).join(' '),
        'Acknowledgement reason',
      ),
    }
  }
  return undefined
}

function revisionCommand(
  action: string,
  arguments_: ParsedArguments,
  sessionId: string,
  delegationId: string,
  revision: number,
): SessionControlMutationCommand {
  if (action === 'verify') {
    const outcome = arguments_.positionals[VERIFICATION_OUTCOME_POSITION]
    if (outcome !== 'passed' && outcome !== 'failed' && outcome !== 'inconclusive') {
      throw new Error('Delegation verification outcome must be passed, failed, or inconclusive.')
    }
    return {
      operation: 'delegation-verify',
      sessionId,
      delegationId,
      submissionRevision: revision,
      outcome,
      summary: required(
        arguments_.positionals.slice(VERIFICATION_SUMMARY_POSITION).join(' '),
        'Verification summary',
      ),
      evidence: delegationEvidence(arguments_),
    }
  }
  if (action === 'propose-amendment') {
    return {
      operation: 'delegation-propose-amendment',
      sessionId,
      delegationId,
      baseSpecificationRevision: revision,
      specification: delegationSpecification(arguments_),
      reason: required(arguments_.positionals.slice(CONTENT_START).join(' '), 'Amendment reason'),
    }
  }
  if (action === 'amend') {
    return {
      operation: 'delegation-amend',
      sessionId,
      delegationId,
      expectedSpecificationRevision: revision,
      specification: delegationSpecification(arguments_),
      reason: required(arguments_.positionals.slice(CONTENT_START).join(' '), 'Amendment reason'),
      ...(option(arguments_, 'proposal') ? { proposalId: option(arguments_, 'proposal') } : {}),
    }
  }
  if (action === 'accept') {
    return {
      operation: 'delegation-accept',
      sessionId,
      delegationId,
      submissionRevision: revision,
      ...(arguments_.positionals.length > CONTENT_START
        ? { note: arguments_.positionals.slice(CONTENT_START).join(' ') }
        : {}),
    }
  }
  if (action === 'request-revision') {
    const revisedObjective = option(arguments_, 'revised-objective')
    return {
      operation: 'delegation-request-revision',
      sessionId,
      delegationId,
      submissionRevision: revision,
      feedback: required(
        arguments_.positionals.slice(CONTENT_START).join(' '),
        'Revision feedback',
      ),
      ...(revisedObjective
        ? {
            revisedSpecification: {
              objective: revisedObjective,
              deliverables: arguments_.options.get('deliverable') ?? [],
              acceptanceCriteria: arguments_.options.get('accept') ?? [],
              resourceReferences: arguments_.options.get('resource') ?? [],
            },
          }
        : {}),
    }
  }
  throw new Error(`Unsupported Delegation action: ${action}.`)
}

export function delegationCommand(arguments_: ParsedArguments): SessionControlMutationCommand {
  const action = required(arguments_.positionals[0], 'Delegation action')
  const sessionId = required(arguments_.positionals[SESSION_POSITION], 'Session ID')
  const delegationId = required(arguments_.positionals[DELEGATION_POSITION], 'Delegation ID')
  if (action === 'submit') {
    return {
      operation: 'delegation-submit',
      sessionId,
      delegationId,
      summary: required(
        arguments_.positionals.slice(REVISION_POSITION).join(' '),
        'Submission summary',
      ),
      evidence: delegationEvidence(arguments_),
    }
  }
  const nonReview = nonReviewCommand(action, arguments_, sessionId, delegationId)
  if (nonReview) return nonReview
  if (action === 'reopen' || action === 'cancel') {
    return {
      operation: action === 'reopen' ? 'delegation-reopen' : 'delegation-cancel',
      sessionId,
      delegationId,
      reason: required(
        arguments_.positionals.slice(REVISION_POSITION).join(' '),
        'Transition reason',
      ),
    }
  }
  const revision = positiveInteger(arguments_.positionals[REVISION_POSITION], 'Submission revision')
  if (revision === 0) throw new Error('Submission revision must be positive.')
  return revisionCommand(action, arguments_, sessionId, delegationId, revision)
}
