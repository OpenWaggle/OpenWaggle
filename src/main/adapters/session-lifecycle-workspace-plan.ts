import path from 'node:path'
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

interface ProjectWorkspaceRow {
  readonly id: string
  readonly kind: string
  readonly working_path: string
  readonly lifecycle_state: string
}

/** Whether `directory` is `root` or somewhere below it. */
function isWithin(directory: string, root: string) {
  const relative = path.relative(root, directory)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * The `current` Workspace is the one the caller works in: an agent's exact Workspace, or the
 * Workspace containing a CLI caller's directory. A caller elsewhere (another project, or a
 * directory OpenWaggle does not manage) has no current Workspace for this project, so the
 * named project's own checkout is used. A caller inside a worktree that is not ready is
 * refused rather than silently moved to the checkout.
 */
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
    const rows = yield* sql<ProjectWorkspaceRow>`
      SELECT id, kind, working_path, lifecycle_state
      FROM workspace_resources
      WHERE project_path = ${projectPath}
    `
    const containing = rows
      .filter((row) => isWithin(workingDirectory, row.working_path))
      .sort((left, right) => right.working_path.length - left.working_path.length)[0]
    if (containing?.lifecycle_state === 'ready') {
      return { mode: 'existing', workspaceId: containing.id } as const
    }
    if (containing?.kind === 'managed-worktree') {
      return yield* Effect.fail(
        preparationError(
          'initiating-workspace-not-ready',
          new Error(
            `The worktree at ${containing.working_path} is ${containing.lifecycle_state}. Wait until it is ready, or pass --workspace local.`,
          ),
        ),
      )
    }
    return yield* localWorkspacePlan(sql, projectPath, input.identities.workspaceId)
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
