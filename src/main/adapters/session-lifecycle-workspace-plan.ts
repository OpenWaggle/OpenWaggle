import type * as SqlClient from '@effect/sql/SqlClient'
import type { ResolvedAgentDefinitionSnapshot } from '@shared/types/agent-definition'
import type { SessionLifecycleCommand } from '@shared/types/session-lifecycle'
import { sessionWorktreeBranchForId } from '@shared/utils/worktree'
import * as Effect from 'effect/Effect'
import { SessionLifecyclePreparationError } from '../errors'
import type { PrepareSessionLifecycleInput } from '../ports/session-lifecycle-preparation-service'
import type { SessionLifecycleWorkspacePlan } from '../ports/session-lifecycle-repository'
import { resolveWorkspaceWorktreePath } from '../services/git/session-worktree-path'

interface ParentRow {
  readonly project_path: string
}

interface WorkspaceRow {
  readonly id: string
}

function preparationError(operation: string, cause: unknown) {
  return new SessionLifecyclePreparationError({ operation, cause })
}

export function projectPathForLifecycleCommand(
  sql: SqlClient.SqlClient,
  command: SessionLifecycleCommand,
) {
  if (command.operation !== 'spawn' && command.operation !== 'fork') {
    return Effect.succeed(command.projectPath)
  }
  const sourceSessionId =
    command.operation === 'spawn' ? command.parentSessionId : command.sourceSessionId
  return Effect.gen(function* () {
    const rows = yield* sql<ParentRow>`
      SELECT project_path FROM sessions WHERE id = ${sourceSessionId} LIMIT 1
    `
    if (!rows[0]) {
      return yield* Effect.fail(preparationError('resolve-source-project', { sourceSessionId }))
    }
    return rows[0].project_path
  })
}

function localWorkspacePlan(
  sql: SqlClient.SqlClient,
  projectPath: string,
  allocatedWorkspaceId: string,
) {
  return Effect.gen(function* () {
    const rows = yield* sql<WorkspaceRow>`
      SELECT id
      FROM workspace_resources
      WHERE project_path = ${projectPath}
        AND kind = 'local'
        AND working_path = ${projectPath}
      LIMIT 1
    `
    return rows[0]
      ? ({ mode: 'existing', workspaceId: rows[0].id } as const)
      : ({
          mode: 'provisioned',
          workspace: {
            id: allocatedWorkspaceId,
            projectPath,
            kind: 'local',
            workingPath: projectPath,
            lifecycleState: 'ready',
          },
        } as const)
  })
}

function currentWorkspacePlan(
  sql: SqlClient.SqlClient,
  input: PrepareSessionLifecycleInput,
  projectPath: string,
) {
  const workingDirectory = input.initiatingWorkingDirectory
  if (!workingDirectory || workingDirectory === projectPath) {
    return localWorkspacePlan(sql, projectPath, input.identities.workspaceId)
  }
  return Effect.gen(function* () {
    const rows = yield* sql<WorkspaceRow>`
      SELECT id
      FROM workspace_resources
      WHERE project_path = ${projectPath}
        AND working_path = ${workingDirectory}
        AND lifecycle_state = 'ready'
      LIMIT 1
    `
    if (!rows[0]) {
      return yield* Effect.fail(
        preparationError('initiating-workspace-not-found', { projectPath, workingDirectory }),
      )
    }
    return { mode: 'existing', workspaceId: rows[0].id } as const
  })
}

function selectedWorkspace(
  command: SessionLifecycleCommand,
  definition: ResolvedAgentDefinitionSnapshot | undefined,
) {
  if (command.workspace) return command.workspace
  const definitionWorkspace = definition?.workspace
  if (command.operation === 'spawn') {
    return definitionWorkspace ? { mode: definitionWorkspace } : { mode: 'share-parent' as const }
  }
  if (command.operation === 'fork') return { mode: 'share-source' as const }
  return definitionWorkspace === 'local' || definitionWorkspace === 'new-worktree'
    ? { mode: definitionWorkspace }
    : { mode: 'current' as const }
}

export function prepareLifecycleWorkspacePlan(
  sql: SqlClient.SqlClient,
  input: PrepareSessionLifecycleInput,
  projectPath: string,
  definition: ResolvedAgentDefinitionSnapshot | undefined,
) {
  const selection = selectedWorkspace(input.request.command, definition)
  if (
    (input.request.command.operation === 'spawn' && selection.mode === 'share-parent') ||
    (input.request.command.operation === 'fork' && selection.mode === 'share-source')
  ) {
    return Effect.succeed<SessionLifecycleWorkspacePlan>({ mode: 'parent' })
  }
  if (selection.mode === 'existing') {
    return Effect.succeed<SessionLifecycleWorkspacePlan>({
      mode: 'existing',
      workspaceId: selection.workspaceId,
    })
  }
  if (selection.mode === 'new-worktree') {
    return Effect.succeed<SessionLifecycleWorkspacePlan>({
      mode: 'provisioned',
      workspace: {
        id: input.identities.workspaceId,
        projectPath,
        kind: 'managed-worktree',
        workingPath: resolveWorkspaceWorktreePath(projectPath, input.identities.workspaceId),
        lifecycleState: 'pending',
        worktreeBranch: sessionWorktreeBranchForId(input.identities.workspaceId),
        ...('baseRef' in selection && selection.baseRef
          ? { worktreeBaseRef: selection.baseRef }
          : {}),
        ...('startFromOrigin' in selection && selection.startFromOrigin !== undefined
          ? { worktreeStartFromOrigin: selection.startFromOrigin }
          : {}),
      },
    })
  }
  if (selection.mode === 'current') return currentWorkspacePlan(sql, input, projectPath)
  return localWorkspacePlan(sql, projectPath, input.identities.workspaceId)
}
