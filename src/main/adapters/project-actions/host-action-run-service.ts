import { join } from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { app } from 'electron'
import { createLogger } from '../../logger'
import { ActionCatalogService } from '../../ports/action-catalog-service'
import { ActionRunService } from '../../ports/action-run-service'
import { WorkspaceExecutionAdmission } from '../../ports/workspace-execution-admission'
import { WorkspacePreparationService } from '../../ports/workspace-preparation-service'
import { getSessionHostEventRuntime } from '../../session-host/session-host-events'
import { makeTerminalHistoryStore } from '../terminal/terminal-history-store'
import { cleanupDeletedActionHistory } from './action-history-cleanup'
import { type ActionProcessRunner, createActionProcessRunner } from './action-process'
import { readActionWorkspaceEnvironment } from './action-workspace-environment'
import { createManagedActionRuns } from './managed-action-runs'
import { createSqliteActionRunPersistence } from './sqlite-action-runs'

const logger = createLogger('project-action-runs')
const runError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))
function attempt<T>(operation: () => Promise<T>) {
  return Effect.tryPromise({ try: operation, catch: runError })
}

export const HostActionRunServiceLive = Layer.scoped(
  ActionRunService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const catalog = yield* ActionCatalogService
    const preparation = yield* WorkspacePreparationService
    const persistence = createSqliteActionRunPersistence(sql)
    const admission = yield* WorkspaceExecutionAdmission
    const history = makeTerminalHistoryStore(join(app.getPath('userData'), 'action-logs'))
    const cleanupHistory = cleanupDeletedActionHistory(sql, history, (workspaceId, cause) =>
      logger.warn('Deleted workspace action history cleanup will be retried', {
        workspaceId,
        error: runError(cause).message,
      }),
    )
    let processRunner: ActionProcessRunner | null = null
    const runner = () => {
      processRunner ??= createActionProcessRunner(app.getVersion())
      return processRunner
    }
    const runs = createManagedActionRuns({
      persistence,
      history,
      runner: {
        validate: (invocation, environment) => runner().validate(invocation, environment),
        start: (input) => runner().start(input),
      },
      catalog: (scope) => Effect.runPromise(catalog.read(scope)),
      environment: (workspace) => readActionWorkspaceEnvironment(preparation, workspace),
      acquireLiveness: () => getSessionHostEventRuntime().liveness.acquire('action-run'),
      reportError: (error) =>
        logger.error('Managed action operation failed', { error: runError(error).message }),
    })
    yield* Effect.addFinalizer(() => attempt(() => runs.shutdown()).pipe(Effect.orDie))
    let recovery: Promise<void> | null = null
    return {
      start: (input) =>
        admission.withWorkspaceMutation(
          input.workspace.workspaceId,
          admission
            .requireActive(input.workspace)
            .pipe(Effect.zipRight(attempt(() => runs.start(input)))),
        ),
      withWorkspaceMutation: admission.withWorkspaceMutation,
      list: (workspaceId) => attempt(() => runs.list(workspaceId)),
      output: (workspaceId, runId, afterOffset) =>
        attempt(() => runs.output(workspaceId, runId, afterOffset)),
      stop: (workspaceId, runId) => attempt(() => runs.stop(workspaceId, runId)),
      stopWorkspaceRuns: (workspaceId) => attempt(() => runs.stopWorkspaceRuns(workspaceId)),
      stopWorkspaceServices: (workspaceId) =>
        attempt(() => runs.stopWorkspaceServices(workspaceId)),
      cleanupDeletedWorkspaces: cleanupHistory,
      recoverAfterHostLoss: attempt(() => {
        recovery ??= persistence.interruptAfterHostLoss()
        return recovery
      }).pipe(Effect.zipRight(cleanupHistory)),
    }
  }),
)
