import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import {
  newWorkspacePlan,
  type ResolveHandoffWorkspaceInput,
} from './session-organization-workspace-plan'

export interface OrganizationWorkspaceRow {
  readonly id: string
  readonly project_path: string
  readonly kind: 'local' | 'managed-worktree'
  readonly working_path: string
  readonly lifecycle_state:
    | 'pending'
    | 'ready'
    | 'materializing'
    | 'missing'
    | 'releasing'
    | 'failed'
  readonly worktree_branch: string | null
  readonly worktree_base_ref: string | null
  readonly handoff_seed_ref: string | null
  readonly handoff_seed_base_ref: string | null
  readonly handoff_seed_state: 'none' | 'pending' | 'applied' | 'failed'
  readonly worktree_start_from_origin: number
}

function loadWorkspace(sql: SqlClient.SqlClient, workspaceId: string) {
  return sql<OrganizationWorkspaceRow>`
    SELECT
      id, project_path, kind, working_path, lifecycle_state,
      worktree_branch, worktree_base_ref, handoff_seed_ref,
      handoff_seed_base_ref, handoff_seed_state, worktree_start_from_origin
    FROM workspace_resources WHERE id = ${workspaceId} LIMIT 1
  `
}

export function resolveHandoffWorkspace(
  sql: SqlClient.SqlClient,
  input: ResolveHandoffWorkspaceInput,
) {
  return Effect.gen(function* () {
    if (input.workspace.mode === 'existing') {
      const rows = yield* loadWorkspace(sql, input.workspace.workspaceId)
      return rows[0] ?? null
    }
    const plan = newWorkspacePlan(input)
    const existing = yield* sql<OrganizationWorkspaceRow>`
      SELECT
        id, project_path, kind, working_path, lifecycle_state,
        worktree_branch, worktree_base_ref, handoff_seed_ref,
        handoff_seed_base_ref, handoff_seed_state, worktree_start_from_origin
      FROM workspace_resources
      WHERE project_path = ${input.projectPath} AND working_path = ${plan.workingPath}
      LIMIT 1
    `
    if (existing[0]) return existing[0]
    yield* sql`
      INSERT INTO workspace_resources (
        id, project_path, kind, working_path, lifecycle_state,
        worktree_branch, worktree_base_ref, handoff_seed_ref, handoff_seed_base_ref,
        handoff_seed_state, worktree_start_from_origin,
        created_at, updated_at
      ) VALUES (
        ${plan.id}, ${input.projectPath}, ${plan.kind}, ${plan.workingPath},
        ${plan.lifecycleState}, ${plan.worktreeBranch}, ${plan.worktreeBaseRef},
        ${plan.seedRef}, ${plan.seedBaseRef}, ${plan.seedState}, ${plan.startFromOrigin},
        ${input.now}, ${input.now}
      )
    `
    return {
      id: plan.id,
      project_path: input.projectPath,
      kind: plan.kind,
      working_path: plan.workingPath,
      lifecycle_state: plan.lifecycleState,
      worktree_branch: plan.worktreeBranch,
      worktree_base_ref: plan.worktreeBaseRef,
      handoff_seed_ref: plan.seedRef,
      handoff_seed_base_ref: plan.seedBaseRef,
      handoff_seed_state: plan.seedState,
      worktree_start_from_origin: plan.startFromOrigin,
    } satisfies OrganizationWorkspaceRow
  })
}
