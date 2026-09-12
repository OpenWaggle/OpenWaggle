import type * as SqlClient from '@effect/sql/SqlClient'
import type { DelegationSpecificationInput } from '@shared/types/session-lifecycle'

export function enqueueDelegationSpecificationUpdate(
  sql: SqlClient.SqlClient,
  input: {
    readonly delegationId: string
    readonly parentSessionId: string
    readonly workerSessionId: string
    readonly specificationRevision: number
    readonly specification: DelegationSpecificationInput
    readonly reason: string
    readonly createdAt: number
  },
) {
  const updateId = `delegation-specification:${input.delegationId}:${input.specificationRevision}`
  return sql`
    INSERT INTO delegation_specification_updates (
      id, delegation_id, parent_session_id, worker_session_id,
      specification_revision, specification_json, reason, status, created_at
    ) VALUES (
      ${updateId}, ${input.delegationId}, ${input.parentSessionId}, ${input.workerSessionId},
      ${input.specificationRevision}, ${JSON.stringify(input.specification)},
      ${input.reason}, ${'pending'}, ${input.createdAt}
    )
  `
}
