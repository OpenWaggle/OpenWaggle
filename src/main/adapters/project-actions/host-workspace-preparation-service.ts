import { join } from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { app } from 'electron'
import { ActionCatalogService } from '../../ports/action-catalog-service'
import { WorkspaceExecutionAdmission } from '../../ports/workspace-execution-admission'
import { WorkspacePreparationService } from '../../ports/workspace-preparation-service'
import { getSessionHostEventRuntime } from '../../session-host/session-host-events'
import { createActionProcessRunner } from './action-process'
import { ManagedWorkspacePreparation } from './managed-workspace-preparation'
import { createPreparationPersistence } from './preparation-persistence'
import { createPreparationExecutor } from './preparation-process'
import { acknowledgePreparationStart } from './preparation-start-acknowledgement'

function attempt<T>(operation: () => Promise<T>) {
  return Effect.tryPromise({
    try: operation,
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}
export const HostWorkspacePreparationServiceLive = Layer.scoped(
  WorkspacePreparationService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const catalog = yield* ActionCatalogService
    const admission = yield* WorkspaceExecutionAdmission
    let execute: ReturnType<typeof createPreparationExecutor> | null = null
    const engine = new ManagedWorkspacePreparation({
      persistence: createPreparationPersistence(sql),
      catalog: (workspace) =>
        Effect.runPromise(
          catalog.read({
            ...workspace,
            workspacePath: workspace.workspacePath.startsWith('pending://')
              ? workspace.projectPath
              : workspace.workspacePath,
          }),
        ),
      execute: (input) => {
        execute ??= createPreparationExecutor(
          createActionProcessRunner(app.getVersion()),
          join(app.getPath('userData'), 'preparation'),
          app.getVersion(),
        )
        return execute(input)
      },
      acquireLiveness: () => getSessionHostEventRuntime().liveness.acquire('action-run'),
    })
    yield* Effect.addFinalizer(() =>
      attempt(async () => {
        await execute?.shutdown()
        await engine.waitForRuns()
      }).pipe(Effect.orDie),
    )
    let recovery: Promise<void> | null = null
    return {
      capture: (workspace, profileId) => attempt(() => engine.capture(workspace, profileId)),
      read: (workspace) => attempt(() => engine.read(workspace)),
      select: (workspace, profileId, revision) =>
        attempt(() => engine.select(workspace, profileId, revision)),
      adopt: (workspace, revision) => attempt(() => engine.adopt(workspace, revision)),
      startSetup: (workspace, revision) =>
        attempt(() =>
          acknowledgePreparationStart((onStarted) =>
            Effect.runPromise(
              admission.withWorkspaceMutation(
                workspace.workspaceId,
                admission
                  .requireActive(workspace)
                  .pipe(
                    Effect.zipRight(
                      attempt(() => engine.run(workspace, 'setup', revision, onStarted)),
                    ),
                  ),
              ),
            ),
          ),
        ),
      // Cleanup is called only inside the worktree-removal admission and its action fence.
      run: (workspace, phase, revision) =>
        phase === 'cleanup'
          ? attempt(() => engine.run(workspace, phase, revision))
          : admission.withWorkspaceMutation(
              workspace.workspaceId,
              (phase === 'setup' ? admission.requireActive(workspace) : Effect.void).pipe(
                Effect.zipRight(attempt(() => engine.run(workspace, phase, revision))),
              ),
            ),
      skip: (workspace, phase, revision) => attempt(() => engine.skip(workspace, phase, revision)),
      review: (workspace, definitionId, enabled, revision) =>
        attempt(() => engine.review(workspace, definitionId, enabled, revision)),
      requireSetup: (workspace) =>
        admission.withWorkspaceMutation(
          workspace.workspaceId,
          admission
            .requireActive(workspace)
            .pipe(Effect.zipRight(attempt(() => engine.requireSetup(workspace)))),
        ),
      environment: (workspaceId) => attempt(() => engine.environment(workspaceId)),
      recoverAfterHostLoss: attempt(() => {
        recovery ??= engine.recoverAfterHostLoss()
        return recovery
      }),
    }
  }),
)
