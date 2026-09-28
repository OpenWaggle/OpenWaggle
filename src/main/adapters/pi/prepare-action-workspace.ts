import type { WorktreeLaunchProgress } from '@shared/types/background-run'
import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import * as Effect from 'effect/Effect'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import type { AgentKernelRunInput } from '../../ports/agent-kernel-service'
import type { SessionWorkspaceResourceRepositoryShape } from '../../ports/session-workspace-resource-repository'
import type { WorkspacePreparationServiceShape } from '../../ports/workspace-preparation-service'
import { readPreparedWorkspaceEnvironment } from '../project-actions/action-workspace-environment'
import { requireSessionProjectPath } from './agent-kernel/session-manager'
import { ensureSessionWorktreeProjectPath } from './agent-kernel/session-worktree-birth'

const SETUP_STARTED: WorktreeLaunchProgress = {
  stage: 'running-setup',
  label: 'Running project setup',
  details: ['Running the project Setup action in the new worktree'],
}
const SETUP_FINISHED: WorktreeLaunchProgress = {
  stage: 'running-setup',
  completesStep: true,
  details: [],
}

/** Only a Setup action that will actually run is worth a launch step; an empty profile is instant. */
function runsSetupAction(preparation: WorkspacePreparation | null) {
  if (!preparation) return false
  if (preparation.setup.status !== 'idle' && preparation.setup.status !== 'running') return false
  return preparation.snapshot.definitions.some(
    (entry) =>
      entry.definition.phase === 'setup' &&
      entry.definition.profileId === preparation.snapshot.profile.id &&
      entry.review !== 'disabled',
  )
}

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
                workspacePath: workspace.pending ? workspace.projectPath : workspace.workingPath,
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
                Effect.flatMap((workspace) => services.preparation.prepareBirth(workspace)),
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
                const reportsSetup = runsSetupAction(yield* services.preparation.read(workspace))
                if (reportsSetup) input.onWorktreeLaunch?.(SETUP_STARTED)
                yield* services.preparation.requireSetup(workspace)
                if (reportsSetup) input.onWorktreeLaunch?.(SETUP_FINISHED)
              }),
            ),
          signal: input.signal,
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
    const workspace = { ...(yield* resolveWorkspace()), workspacePath: executionPath }
    const preparedEnvironment = yield* Effect.tryPromise({
      try: () => readPreparedWorkspaceEnvironment(services.preparation, workspace),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
    return { projectPath, executionPath, preparedEnvironment }
  })
}
