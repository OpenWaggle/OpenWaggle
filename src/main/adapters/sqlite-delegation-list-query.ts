import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { DelegationState } from '@shared/types/session-collaboration'
import * as Effect from 'effect/Effect'
import { delegationListResponse } from './sqlite-delegation-list-response'
import { readDelegationListCursor } from './sqlite-delegation-query-cursor'
import type { DelegationsListRequest } from './sqlite-delegation-query-model'
import type { DelegationSummaryRow } from './sqlite-delegation-query-rows'
import { authorizedSessionScope, invalidSessionQueryCursor } from './sqlite-session-query-support'

export function listDelegations(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: DelegationsListRequest,
) {
  const cursor = readDelegationListCursor(request)
  if (cursor === 'invalid') return Effect.succeed(invalidSessionQueryCursor(request))
  const allowed = authorizedSessionScope(authority)
  const projectPath = request.query.projectPath ?? null
  const parentSessionId = request.query.parentSessionId ?? null
  const workingPath = request.query.workingPath ?? null
  const workerSessionId = request.query.workerSessionId ?? null
  const statesSelected = request.query.states?.length ? 1 : 0
  const requestedStates: readonly DelegationState[] = request.query.states?.length
    ? request.query.states
    : ['working']
  const states: readonly DelegationState[] = [...new Set(requestedStates)]
  const cursorUpdatedAt = cursor?.updatedAt ?? null
  const cursorDelegationId = cursor?.delegationId ?? null
  return Effect.gen(function* () {
    const rows = yield* sql<DelegationSummaryRow>`
      SELECT contracts.id AS delegation_id,
        contracts.parent_session_id,
        contracts.child_session_id AS worker_session_id,
        contracts.state,
        specifications.specification_json,
        contracts.current_specification_revision,
        COALESCE(MAX(submissions.revision), 0) AS latest_submission_revision,
        contracts.created_at,
        contracts.updated_at
      FROM delegation_contracts AS contracts
      JOIN delegation_specifications AS specifications
        ON specifications.delegation_id = contracts.id
        AND specifications.revision = contracts.current_specification_revision
      JOIN sessions AS workers ON workers.id = contracts.child_session_id
      LEFT JOIN session_spawn_lineage AS lineage ON lineage.child_session_id = workers.id
      LEFT JOIN delegation_submissions AS submissions ON submissions.delegation_id = contracts.id
      WHERE (${projectPath} IS NULL OR workers.project_path = ${projectPath})
        AND (${workingPath} IS NULL OR EXISTS (
          SELECT 1 FROM session_workspace_bindings AS delegation_binding
          JOIN workspace_resources AS delegation_workspace
            ON delegation_workspace.id = delegation_binding.workspace_id
          WHERE delegation_binding.session_id = workers.id
            AND delegation_workspace.working_path = ${workingPath}
        ))
        AND (${parentSessionId} IS NULL OR contracts.parent_session_id = ${parentSessionId})
        AND (${workerSessionId} IS NULL OR contracts.child_session_id = ${workerSessionId})
        AND (${statesSelected} = 0 OR contracts.state IN ${sql.in(states)})
        AND (${cursorUpdatedAt} IS NULL
          OR contracts.updated_at < ${cursorUpdatedAt}
          OR (contracts.updated_at = ${cursorUpdatedAt}
            AND contracts.id < ${cursorDelegationId}))
        AND (
          ${allowed.all} = 1
          OR workers.project_path IN ${sql.in(allowed.projectPaths)}
          OR workers.id IN ${sql.in(allowed.sessionIds)}
          OR COALESCE(lineage.hive_root_session_id, workers.id)
            IN ${sql.in(allowed.hiveRootSessionIds)}
        )
      GROUP BY contracts.id
      ORDER BY contracts.updated_at DESC, contracts.id DESC
      LIMIT ${request.query.limit + 1}
    `
    return delegationListResponse(request, rows)
  })
}
