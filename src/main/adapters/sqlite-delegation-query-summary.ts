import type { DelegationQuerySummary } from '@shared/types/session-query'
import type { DelegationSummaryRow } from './sqlite-delegation-query-rows'
import { parseSessionJson } from './sqlite-session-query-support'

export function delegationSummary(row: DelegationSummaryRow): DelegationQuerySummary {
  const specification = parseSessionJson(row.specification_json)
  const objective =
    typeof specification === 'object' &&
    specification !== null &&
    'objective' in specification &&
    typeof specification.objective === 'string'
      ? specification.objective
      : ''
  return {
    delegationId: row.delegation_id,
    parentSessionId: row.parent_session_id,
    workerSessionId: row.worker_session_id,
    state: row.state,
    objective,
    currentSpecificationRevision: row.current_specification_revision,
    latestSubmissionRevision: row.latest_submission_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
