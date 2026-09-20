import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { enqueueDelegationSpecificationUpdate } from './sqlite-session-delegation-specification-update'
import {
  type DelegationContractRow,
  type ExecuteDelegationInput,
  rejectedDelegationOutcome,
  updatedDelegationOutcome,
} from './sqlite-session-delegation-support'

function dependenciesSatisfied(sql: SqlClient.SqlClient, delegationId: string) {
  return sql<{ blocked: number }>`
    SELECT EXISTS (
      SELECT 1 FROM delegation_dependencies AS dependencies
      JOIN delegation_contracts AS required
        ON required.id = dependencies.dependency_delegation_id
      WHERE dependencies.delegation_id = ${delegationId}
        AND (
          (dependencies.required_state = 'accepted' AND required.state <> 'accepted')
          OR (dependencies.required_state = 'ready_for_review'
            AND required.state NOT IN ('ready_for_review', 'accepted'))
        )
    ) AS blocked
  `.pipe(Effect.map((rows) => rows[0]?.blocked !== 1))
}

export function reviewDelegation(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
) {
  return Effect.gen(function* () {
    const command = input.request.command
    if (
      command.operation !== 'delegation-request-revision' &&
      command.operation !== 'delegation-accept'
    ) {
      return undefined
    }
    if (command.sessionId !== contract.parent_session_id) {
      return rejectedDelegationOutcome(input, 'parent_required')
    }
    if (contract.state !== 'ready_for_review') {
      return rejectedDelegationOutcome(input, 'delegation_not_reviewable')
    }
    if (command.submissionRevision !== contract.latest_submission_revision) {
      return rejectedDelegationOutcome(input, 'submission_revision_stale')
    }
    if (
      command.operation === 'delegation-accept' &&
      !(yield* dependenciesSatisfied(sql, contract.id))
    ) {
      return rejectedDelegationOutcome(input, 'delegation_dependencies_unmet')
    }
    let specificationRevision = contract.current_specification_revision
    if (command.operation === 'delegation-request-revision' && command.revisedSpecification) {
      const dependencyRows = yield* sql<{
        readonly dependency_delegation_id: string
        readonly required_state: 'ready_for_review' | 'accepted'
      }>`
        SELECT dependency_delegation_id, required_state FROM delegation_dependencies
        WHERE delegation_id = ${contract.id} ORDER BY dependency_delegation_id
      `
      const revisedSpecification = {
        ...command.revisedSpecification,
        dependencies: dependencyRows.map((dependency) => ({
          delegationId: dependency.dependency_delegation_id,
          requiredState: dependency.required_state,
        })),
      }
      specificationRevision += 1
      yield* sql`
        INSERT INTO delegation_specifications (
          delegation_id, revision, specification_json, authored_by, reason, created_at
        ) VALUES (
          ${contract.id}, ${specificationRevision}, ${JSON.stringify(revisedSpecification)},
          ${input.callerId}, ${command.feedback}, ${input.now}
        )
      `
      yield* enqueueDelegationSpecificationUpdate(sql, {
        delegationId: contract.id,
        parentSessionId: contract.parent_session_id,
        workerSessionId: contract.child_session_id,
        specificationRevision,
        specification: revisedSpecification,
        reason: command.feedback,
        createdAt: input.now,
      })
    }
    const state = command.operation === 'delegation-accept' ? 'accepted' : 'revision_requested'
    const feedback = command.operation === 'delegation-accept' ? command.note : command.feedback
    yield* sql`
      INSERT INTO delegation_reviews (
        delegation_id, submission_revision, decision, feedback,
        reviewer_session_id, reviewed_by, specification_revision, created_at
      ) VALUES (
        ${contract.id}, ${command.submissionRevision}, ${state}, ${feedback ?? null},
        ${command.sessionId}, ${input.callerId}, ${specificationRevision}, ${input.now}
      )
    `
    yield* sql`
      UPDATE delegation_contracts
      SET state = ${state}, current_specification_revision = ${specificationRevision},
        updated_at = ${input.now}
      WHERE id = ${contract.id}
    `
    return updatedDelegationOutcome(
      input,
      contract,
      state,
      command.submissionRevision,
      specificationRevision,
      command.operation === 'delegation-request-revision' &&
        command.revisedSpecification !== undefined,
    )
  })
}
