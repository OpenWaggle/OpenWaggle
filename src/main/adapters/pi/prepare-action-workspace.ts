import * as Effect from 'effect/Effect'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import type { AgentKernelRunInput } from '../../ports/agent-kernel-service'
import type { SessionWorkspaceResourceRepositoryShape } from '../../ports/session-workspace-resource-repository'
import type { WorkspacePreparationServiceShape } from '../../ports/workspace-preparation-service'
import { requireSessionProjectPath } from './agent-kernel/session-manager'
import { ensureSessionWorktreeProjectPath } from './agent-kernel/session-worktree-birth'

export function prepareActionWorkspace(
  input: AgentKernelRunInput,
  services: {
    readonly workspaces: Pick<SessionWorkspaceResourceRepositoryShape, 'getBound'>
    readonly preparation: WorkspacePreparationServiceShape
  },
) {
  return Effect.gen(function* () {
    const projectPath = requireSessionProjectPath(input.session)
    const resolveWorkspace = () =>
      services.workspaces.getBound(input.session.id).pipe(
        Effect.flatMap((workspace) =>
          workspace
            ? Effect.succeed({
                workspaceId: workspace.id,
                projectPath: workspace.projectPath,
                workspacePath: workspace.workingPath,
                sessionId: String(input.session.id),
              } satisfies ActionRunWorkspace)
            : Effect.fail(new Error('This Session no longer has a Workspace binding.')),
        ),
      )
    const executionPath = yield* Effect.tryPromise({
      try: () =>
        ensureSessionWorktreeProjectPath(input.session, {
          ...(input.onWorktreeLaunch ? { onProgress: input.onWorktreeLaunch } : {}),
          onBeforeWorktreeCreate: () =>
            Effect.runPromise(
              resolveWorkspace().pipe(
                Effect.flatMap((workspace) => services.preparation.capture(workspace)),
                Effect.asVoid,
              ),
            ),
          onSetupPending: ({ worktreePath, resumingClaim }) =>
            Effect.runPromise(
              Effect.gen(function* () {
                const workspace = { ...(yield* resolveWorkspace()), workspacePath: worktreePath }
                const existing = yield* services.preparation.read(workspace)
                yield* services.preparation.capture(workspace)
                if (resumingClaim && !existing)
                  return yield* Effect.fail(
                    new Error(
                      'A previous setup dispatch has no confirmed result. Review Workspace preparation and explicitly run setup or continue.',
                    ),
                  )
                yield* services.preparation.requireSetup(workspace)
              }),
            ),
          signal: input.signal,
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
    const workspace = { ...(yield* resolveWorkspace()), workspacePath: executionPath }
    if (input.session.environmentMode === 'worktree')
      yield* services.preparation.requireSetup(workspace)
    const preparedEnvironment = yield* services.preparation.environment(workspace.workspaceId)
    return { projectPath, executionPath, preparedEnvironment }
  })
}
