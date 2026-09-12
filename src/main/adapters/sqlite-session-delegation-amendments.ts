import { randomUUID } from 'node:crypto'
import type * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import type { SessionControlMutationOutcome } from '@shared/types/session-control'
import type { DelegationSpecificationInput } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { validateNewDependency } from './sqlite-session-delegation-dependencies'
import { enqueueDelegationSpecificationUpdate } from './sqlite-session-delegation-specification-update'
import {
  type DelegationContractRow,
  type ExecuteDelegationInput,
  rejectedDelegationOutcome,
} from './sqlite-session-delegation-support'

interface AmendmentProposalRow {
  readonly id: string
  readonly base_specification_revision: number
  readonly specification_json: string
  readonly status: 'pending' | 'applied'
}

function proposeAmendment(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
) {
  return Effect.gen(function* () {
    const command = input.request.command
    if (command.operation !== 'delegation-propose-amendment') return undefined
    if (command.sessionId !== contract.child_session_id) {
      return rejectedDelegationOutcome(input, 'worker_required')
    }
    if (['accepted', 'cancelled'].includes(contract.state)) {
      return rejectedDelegationOutcome(input, 'delegation_not_amendable')
    }
    if (command.baseSpecificationRevision !== contract.current_specification_revision) {
      return rejectedDelegationOutcome(input, 'specification_revision_stale')
    }
    if (command.reason.trim().length === 0) {
      return rejectedDelegationOutcome(input, 'amendment_reason_required')
    }
    const proposalId = randomUUID()
    yield* sql`
      INSERT INTO delegation_amendment_proposals (
        id, delegation_id, base_specification_revision, specification_json,
        reason, actor_session_id, proposed_by, status, created_at, updated_at
      ) VALUES (
        ${proposalId}, ${contract.id}, ${command.baseSpecificationRevision},
        ${JSON.stringify(command.specification)}, ${command.reason.trim()},
        ${command.sessionId}, ${input.callerId}, ${'pending'}, ${input.now}, ${input.now}
      )
    `
    return {
      operation: command.operation,
      effect: 'delegation-amendment-proposed',
      sessionId: command.sessionId,
      delegationId: contract.id,
      proposalId,
      baseSpecificationRevision: command.baseSpecificationRevision,
    } satisfies Extract<
      SessionControlMutationOutcome,
      { readonly effect: 'delegation-amendment-proposed' }
    >
  })
}

function validateSpecificationDependencies(
  sql: SqlClient.SqlClient,
  contract: DelegationContractRow,
  specification: DelegationSpecificationInput,
) {
  return Effect.gen(function* () {
    const identities = specification.dependencies.map((item) => item.delegationId)
    if (new Set(identities).size !== identities.length) return false
    for (const dependency of specification.dependencies) {
      if (!(yield* validateNewDependency(sql, contract, dependency.delegationId))) return false
    }
    return true
  })
}

function loadProposal(
  sql: SqlClient.SqlClient,
  delegationId: string,
  proposalId: string | undefined,
) {
  if (!proposalId) return Effect.succeed(undefined)
  return sql<AmendmentProposalRow>`
    SELECT id, base_specification_revision, specification_json, status
    FROM delegation_amendment_proposals
    WHERE id = ${proposalId} AND delegation_id = ${delegationId} LIMIT 1
  `.pipe(Effect.map((rows) => rows[0]))
}

function proposalRejection(
  proposal: AmendmentProposalRow | undefined,
  proposalId: string | undefined,
  expectedRevision: number,
  specification: DelegationSpecificationInput,
) {
  if (!proposalId) return undefined
  if (!proposal) return 'delegation_amendment_proposal_not_found'
  if (proposal.status !== 'pending') return 'delegation_amendment_proposal_not_pending'
  if (proposal.base_specification_revision !== expectedRevision) {
    return 'delegation_amendment_proposal_stale'
  }
  return canonicalJson(JSON.parse(proposal.specification_json)) === canonicalJson(specification)
    ? undefined
    : 'delegation_amendment_proposal_mismatch'
}

function persistAmendment(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
  specification: DelegationSpecificationInput,
  proposalId: string | undefined,
) {
  const command = input.request.command
  if (command.operation !== 'delegation-amend') throw new Error('Expected Delegation amendment.')
  const revision = contract.current_specification_revision + 1
  const state = contract.latest_submission_revision > 0 ? 'revision_requested' : contract.state
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO delegation_specifications (
        delegation_id, revision, specification_json, authored_by, reason, created_at
      ) VALUES (
        ${contract.id}, ${revision}, ${JSON.stringify(specification)},
        ${input.callerId}, ${command.reason.trim()}, ${input.now}
      )
    `
    yield* enqueueDelegationSpecificationUpdate(sql, {
      delegationId: contract.id,
      parentSessionId: contract.parent_session_id,
      workerSessionId: contract.child_session_id,
      specificationRevision: revision,
      specification,
      reason: command.reason.trim(),
      createdAt: input.now,
    })
    yield* sql`DELETE FROM delegation_dependencies WHERE delegation_id = ${contract.id}`
    for (const dependency of specification.dependencies) {
      yield* sql`
        INSERT INTO delegation_dependencies (
          delegation_id, dependency_delegation_id, required_state, created_at
        ) VALUES (
          ${contract.id}, ${dependency.delegationId}, ${dependency.requiredState}, ${input.now}
        )
      `
    }
    if (state !== contract.state) {
      yield* sql`
        INSERT INTO delegation_state_transitions (
          delegation_id, from_state, to_state, reason,
          actor_session_id, authored_by, created_at
        ) VALUES (
          ${contract.id}, ${contract.state}, ${state}, ${command.reason.trim()},
          ${command.sessionId}, ${input.callerId}, ${input.now}
        )
      `
    }
    yield* sql`
      UPDATE delegation_contracts SET current_specification_revision = ${revision},
        state = ${state}, updated_at = ${input.now} WHERE id = ${contract.id}
    `
    if (proposalId) {
      yield* sql`
        UPDATE delegation_amendment_proposals SET status = ${'applied'},
          reviewed_by = ${input.callerId}, applied_specification_revision = ${revision},
          updated_at = ${input.now} WHERE id = ${proposalId}
      `
    }
    return { revision, state }
  })
}

function amendSpecification(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
) {
  return Effect.gen(function* () {
    const command = input.request.command
    if (command.operation !== 'delegation-amend') return undefined
    if (command.sessionId !== contract.parent_session_id) {
      return rejectedDelegationOutcome(input, 'parent_required')
    }
    if (['accepted', 'cancelled'].includes(contract.state)) {
      return rejectedDelegationOutcome(input, 'delegation_not_amendable')
    }
    if (command.expectedSpecificationRevision !== contract.current_specification_revision) {
      return rejectedDelegationOutcome(input, 'specification_revision_stale')
    }
    if (command.reason.trim().length === 0) {
      return rejectedDelegationOutcome(input, 'amendment_reason_required')
    }
    const proposal = yield* loadProposal(sql, contract.id, command.proposalId)
    const invalidProposal = proposalRejection(
      proposal,
      command.proposalId,
      command.expectedSpecificationRevision,
      command.specification,
    )
    if (invalidProposal) return rejectedDelegationOutcome(input, invalidProposal)
    if (!(yield* validateSpecificationDependencies(sql, contract, command.specification))) {
      return rejectedDelegationOutcome(input, 'delegation_dependency_invalid')
    }
    const applied = yield* persistAmendment(
      sql,
      input,
      contract,
      command.specification,
      command.proposalId,
    )
    return {
      operation: command.operation,
      effect: 'delegation-specification-amended',
      sessionId: command.sessionId,
      delegationId: contract.id,
      delegationState: applied.state,
      specificationRevision: applied.revision,
      workerSessionId: contract.child_session_id,
      ...(command.proposalId ? { appliedProposalId: command.proposalId } : {}),
    } satisfies Extract<
      SessionControlMutationOutcome,
      { readonly effect: 'delegation-specification-amended' }
    >
  })
}

export function updateDelegationAmendment(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
) {
  return Effect.gen(function* () {
    const proposal = yield* proposeAmendment(sql, input, contract)
    return proposal ?? (yield* amendSpecification(sql, input, contract))
  })
}
