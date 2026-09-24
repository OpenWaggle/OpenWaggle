import * as Effect from 'effect/Effect'
import { reconcileInterruptedAgentRuns } from '../application/agent-run-service'
import { recoverPendingManagedWorktreeRemovals } from '../application/host-ui-worktree-operation'
import { recoverSessionExportsAfterHostLoss } from '../application/session-export-recovery'
import { recoverPendingSessionHandoffs } from '../application/session-organization-service'
import { createLogger } from '../logger'
import { ActionRunService } from '../ports/action-run-service'
import { SessionHostRecoveryRepository } from '../ports/session-host-recovery-repository'
import { SessionLifecyclePreparationService } from '../ports/session-lifecycle-preparation-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { WorkspacePreparationService } from '../ports/workspace-preparation-service'

const logger = createLogger('session-host/bootstrap')

export function recoverHostState() {
  return Effect.gen(function* () {
    // Removal recovery must see interrupted attempts before deciding whether cleanup may run.
    yield* (yield* WorkspacePreparationService).recoverAfterHostLoss
    yield* (yield* ActionRunService).recoverAfterHostLoss
    const repository = yield* SessionHostRecoveryRepository
    const projection = yield* SessionProjectionRepository
    const lifecyclePreparation = yield* SessionLifecyclePreparationService
    const recovery = yield* repository.recoverAfterHostLoss(Date.now())
    const removalRecovery = yield* recoverPendingManagedWorktreeRemovals(
      recovery.pendingWorktreeRemovals,
    )
    for (const result of removalRecovery) {
      if (result.outcome._tag === 'Left') {
        logger.error('Pending managed worktree removal recovery failed closed.', {
          resourceId: result.resourceId,
          error: result.outcome.left.message,
        })
      }
    }
    yield* projection.recoverPendingDeletions?.() ?? Effect.void
    yield* lifecyclePreparation.recoverPending
    const handoffRecovery = yield* recoverPendingSessionHandoffs(recovery.pendingHandoffs)
    for (const result of handoffRecovery) {
      if (result._tag === 'Left') {
        logger.error('Pending Workspace handoff recovery exhausted retries.', {
          error: result.left instanceof Error ? result.left.message : String(result.left),
        })
      }
    }
    yield* recoverSessionExportsAfterHostLoss()
    yield* reconcileInterruptedAgentRuns()
  })
}
