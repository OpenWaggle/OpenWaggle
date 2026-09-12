import type * as SqlClient from '@effect/sql/SqlClient'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { delegationSpecificationSchema } from '@shared/schemas/session-lifecycle'
import type { SessionControlMutationOutcome } from '@shared/types/session-control'
import type { DelegationSpecificationInput } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { enqueueDelegationSpecificationUpdate } from './sqlite-session-delegation-specification-update'
import {
  type DelegationContractRow,
  type ExecuteDelegationInput,
  rejectedDelegationOutcome,
} from './sqlite-session-delegation-support'

interface DependencyRow {
  readonly dependency_delegation_id: string
  readonly required_state: 'ready_for_review' | 'accepted'
}

function parseSpecification(value: string): DelegationSpecificationInput | undefined {
  try {
    return decodeUnknownExactOrThrow(delegationSpecificationSchema, JSON.parse(value))
  } catch {
    return undefined
  }
}

function commandRejection(input: ExecuteDelegationInput, contract: DelegationContractRow) {
  const command = input.request.command
  if (command.operation !== 'delegation-dependency') return undefined
  if (command.sessionId !== contract.parent_session_id) return 'parent_required'
  if (['accepted', 'cancelled'].includes(contract.state)) return 'delegation_not_amendable'
  if (command.reason.trim().length === 0) return 'dependency_reason_required'
  return undefined
}

function editRejection(action: 'add' | 'remove', dependencyExists: boolean) {
  if (action === 'add' && dependencyExists) return 'delegation_dependency_exists'
  if (action === 'remove' && !dependencyExists) return 'delegation_dependency_not_found'
  return undefined
}

function dependencyTargetAllowed(
  sql: SqlClient.SqlClient,
  contract: DelegationContractRow,
  dependencyDelegationId: string,
) {
  return sql<{ allowed: number }>`
    SELECT EXISTS (
      SELECT 1 FROM delegation_contracts AS dependency
      JOIN sessions AS dependency_worker ON dependency_worker.id = dependency.child_session_id
      JOIN sessions AS current_worker ON current_worker.id = ${contract.child_session_id}
      WHERE dependency.id = ${dependencyDelegationId}
        AND dependency_worker.project_path = current_worker.project_path
    ) AS allowed
  `.pipe(Effect.map((rows) => rows[0]?.allowed === 1))
}

function createsDependencyCycle(
  sql: SqlClient.SqlClient,
  delegationId: string,
  dependencyDelegationId: string,
) {
  if (delegationId === dependencyDelegationId) return Effect.succeed(true)
  return sql<{ cyclic: number }>`
    WITH RECURSIVE reachable(delegation_id) AS (
      SELECT dependency_delegation_id FROM delegation_dependencies
      WHERE delegation_id = ${dependencyDelegationId}
      UNION
      SELECT dependencies.dependency_delegation_id
      FROM delegation_dependencies AS dependencies
      JOIN reachable ON dependencies.delegation_id = reachable.delegation_id
    )
    SELECT EXISTS (
      SELECT 1 FROM reachable WHERE delegation_id = ${delegationId}
    ) AS cyclic
  `.pipe(Effect.map((rows) => rows[0]?.cyclic === 1))
}

export function validateNewDependency(
  sql: SqlClient.SqlClient,
  contract: DelegationContractRow,
  dependencyDelegationId: string,
) {
  return Effect.gen(function* () {
    const allowed = yield* dependencyTargetAllowed(sql, contract, dependencyDelegationId)
    if (!allowed) return false
    return !(yield* createsDependencyCycle(sql, contract.id, dependencyDelegationId))
  })
}

export function updateDelegationDependency(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
) {
  return Effect.gen(function* () {
    const command = input.request.command
    if (command.operation !== 'delegation-dependency') return undefined
    const initialRejection = commandRejection(input, contract)
    if (initialRejection) return rejectedDelegationOutcome(input, initialRejection)
    const specificationRows = yield* sql<{ specification_json: string }>`
      SELECT specification_json FROM delegation_specifications
      WHERE delegation_id = ${contract.id}
        AND revision = ${contract.current_specification_revision}
      LIMIT 1
    `
    const specification = specificationRows[0]
      ? parseSpecification(specificationRows[0].specification_json)
      : undefined
    if (!specification) return rejectedDelegationOutcome(input, 'delegation_specification_invalid')
    const dependencyRows = yield* sql<DependencyRow>`
      SELECT dependency_delegation_id, required_state FROM delegation_dependencies
      WHERE delegation_id = ${contract.id} ORDER BY dependency_delegation_id
    `
    const dependencyExists = dependencyRows.some(
      (item) => item.dependency_delegation_id === command.dependencyDelegationId,
    )
    const invalidEdit = editRejection(command.action, dependencyExists)
    if (invalidEdit) return rejectedDelegationOutcome(input, invalidEdit)
    if (
      command.action === 'add' &&
      !(yield* validateNewDependency(sql, contract, command.dependencyDelegationId))
    ) {
      return rejectedDelegationOutcome(input, 'delegation_dependency_invalid')
    }
    const dependencies =
      command.action === 'add'
        ? [
            ...dependencyRows,
            {
              dependency_delegation_id: command.dependencyDelegationId,
              required_state: command.requiredState,
            },
          ]
        : dependencyRows.filter(
            (item) => item.dependency_delegation_id !== command.dependencyDelegationId,
          )
    const specificationRevision = contract.current_specification_revision + 1
    const revisedSpecification = {
      ...specification,
      dependencies: dependencies.map((item) => ({
        delegationId: item.dependency_delegation_id,
        requiredState: item.required_state,
      })),
    }
    yield* sql`
      INSERT INTO delegation_specifications (
        delegation_id, revision, specification_json, authored_by, reason, created_at
      ) VALUES (
        ${contract.id}, ${specificationRevision}, ${JSON.stringify(revisedSpecification)},
        ${input.callerId}, ${command.reason.trim()}, ${input.now}
      )
    `
    yield* enqueueDelegationSpecificationUpdate(sql, {
      delegationId: contract.id,
      parentSessionId: contract.parent_session_id,
      workerSessionId: contract.child_session_id,
      specificationRevision,
      specification: revisedSpecification,
      reason: command.reason.trim(),
      createdAt: input.now,
    })
    yield* sql`DELETE FROM delegation_dependencies WHERE delegation_id = ${contract.id}`
    for (const dependency of dependencies) {
      yield* sql`
        INSERT INTO delegation_dependencies (
          delegation_id, dependency_delegation_id, required_state, created_at
        ) VALUES (
          ${contract.id}, ${dependency.dependency_delegation_id},
          ${dependency.required_state}, ${input.now}
        )
      `
    }
    const state = contract.latest_submission_revision > 0 ? 'revision_requested' : contract.state
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
      UPDATE delegation_contracts SET current_specification_revision = ${specificationRevision},
        state = ${state}, updated_at = ${input.now} WHERE id = ${contract.id}
    `
    return {
      operation: command.operation,
      effect: 'delegation-dependencies-updated',
      sessionId: command.sessionId,
      delegationId: contract.id,
      delegationState: state,
      specificationRevision,
      dependencyCount: dependencies.length,
      workerSessionId: contract.child_session_id,
    } satisfies Extract<
      SessionControlMutationOutcome,
      { readonly effect: 'delegation-dependencies-updated' }
    >
  })
}
