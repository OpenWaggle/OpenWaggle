import { match } from '@diegogbrisa/ts-match'
import { decodeUnknownOrThrow } from '@shared/schema'
import { actionManagementRequestSchema } from '@shared/schemas/action-management'
import type { ActionManagementResult, ActionManagementScope } from '@shared/types/action-management'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { ActionCatalogService } from '../ports/action-catalog-service'
import { ActionRunService, type ActionRunWorkspace } from '../ports/action-run-service'
import { SessionWorkspaceResourceRepository } from '../ports/session-workspace-resource-repository'
import { WorkspaceProjectAuthorization } from '../ports/workspace-project-authorization'
import { validateRequiredProjectPath } from '../utils/project-path-validation'
import { listRetainedPreparation } from './retained-workspace-preparation'
import { manageWorkspacePreparation } from './workspace-preparation-management'

export function resolveActionManagementWorkspace(scope: ActionManagementScope) {
  return Effect.gen(function* () {
    const authorization = yield* WorkspaceProjectAuthorization
    const projectPath = yield* authorization.authorize(scope.projectPath)
    if (!scope.sessionId && !scope.workspaceId)
      return { projectPath, workspacePath: projectPath, workspaceId: null }
    const repository = yield* SessionWorkspaceResourceRepository
    const workspace = yield* scope.sessionId
      ? repository.getBound(SessionId(scope.sessionId))
      : repository.getById(scope.workspaceId ?? '')
    if (!workspace) return yield* Effect.fail(new Error('This Session has no active Workspace.'))
    const root = yield* validateRequiredProjectPath(workspace.projectPath)
    if (root !== projectPath) {
      return yield* Effect.fail(new Error('This Session belongs to a different project.'))
    }
    return {
      projectPath,
      // Planned worktrees have a real future path, not necessarily a pending:// placeholder.
      // Definition management remains available before birth; run admission still rejects pending bindings.
      workspacePath: workspace.pending ? projectPath : workspace.workingPath,
      workspaceId: workspace.id,
      ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
    }
  })
}

export function manageProjectActions(rawRequest: unknown) {
  return Effect.gen(function* () {
    const request = decodeUnknownOrThrow(actionManagementRequestSchema, rawRequest)
    const workspace = yield* resolveActionManagementWorkspace(request.scope)
    const catalog = yield* ActionCatalogService
    const runs = yield* ActionRunService
    const requireWorkspace = (): Effect.Effect<ActionRunWorkspace, Error> =>
      workspace.workspaceId === null
        ? Effect.fail(new Error('Select a Session to run or inspect actions in its Workspace.'))
        : Effect.succeed({ ...workspace, workspaceId: workspace.workspaceId })
    return yield* match(request.operation)
      .with(
        { type: 'preparation' },
        { type: 'stop-setup' },
        { type: 'select-preparation' },
        { type: 'adopt-preparation' },
        { type: 'review-snapshot' },
        { type: 'run-preparation' },
        { type: 'skip-preparation' },
        (operation) =>
          requireWorkspace().pipe(
            Effect.flatMap((workspace) => manageWorkspacePreparation(workspace, operation)),
          ),
      )
      .with({ type: 'retained-preparation' }, () => listRetainedPreparation(workspace.projectPath))
      .with({ type: 'catalog' }, () =>
        catalog
          .read({
            ...workspace,
            workspacePath: workspace.workspacePath.startsWith('pending://')
              ? workspace.projectPath
              : workspace.workspacePath,
          })
          .pipe(Effect.map((catalog) => ({ type: 'catalog', catalog }) as const)),
      )
      .with({ type: 'edit' }, ({ revision, edit }) =>
        catalog
          .edit(
            {
              ...workspace,
              workspacePath: workspace.workspacePath.startsWith('pending://')
                ? workspace.projectPath
                : workspace.workspacePath,
            },
            revision,
            edit,
          )
          .pipe(Effect.map((catalog) => ({ type: 'catalog', catalog }) as const)),
      )
      .with({ type: 'discover' }, () =>
        catalog
          .discover(
            workspace.workspacePath.startsWith('pending://')
              ? workspace.projectPath
              : workspace.workspacePath,
          )
          .pipe(Effect.map((discovery) => ({ type: 'discovery', discovery }) as const)),
      )
      .with({ type: 'runs' }, () =>
        (workspace.workspaceId ? runs.list(workspace.workspaceId) : Effect.succeed([])).pipe(
          Effect.map((runs) => ({ type: 'runs', runs }) as const),
        ),
      )
      .with({ type: 'start' }, (operation) =>
        requireWorkspace().pipe(
          Effect.flatMap((workspace) => runs.start({ ...operation, workspace })),
          Effect.map((run) => ({ type: 'run', run }) as const),
        ),
      )
      .with({ type: 'stop' }, ({ runId }) =>
        requireWorkspace().pipe(
          Effect.flatMap(({ workspaceId }) => runs.stop(workspaceId, runId)),
          Effect.map((run) => ({ type: 'run', run }) as const),
        ),
      )
      .with({ type: 'output' }, ({ runId, afterOffset }) =>
        requireWorkspace().pipe(
          Effect.flatMap(({ workspaceId }) => runs.output(workspaceId, runId, afterOffset)),
          Effect.map((output) => ({ type: 'output', output }) as const),
        ),
      )
      .exhaustive()
  }).pipe(Effect.map((result): ActionManagementResult => result))
}
