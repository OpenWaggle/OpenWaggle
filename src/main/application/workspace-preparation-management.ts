import { match } from '@diegogbrisa/ts-match'
import type { PreparationOperation } from '@shared/types/workspace-preparation'
import * as Effect from 'effect/Effect'
import type { ActionRunWorkspace } from '../ports/action-run-service'
import { WorkspacePreparationService } from '../ports/workspace-preparation-service'

export function manageWorkspacePreparation(
  workspace: ActionRunWorkspace,
  operation: PreparationOperation,
) {
  return Effect.gen(function* () {
    const service = yield* WorkspacePreparationService
    return yield* match(operation)
      .with({ type: 'preparation' }, () => service.read(workspace))
      .with({ type: 'stop-setup' }, ({ attemptId }) => service.stopSetup(workspace, attemptId))
      .with({ type: 'select-preparation' }, ({ profileId, expectedRevision }) =>
        service.select(workspace, profileId, expectedRevision),
      )
      .with({ type: 'adopt-preparation' }, ({ expectedRevision }) =>
        service.adopt(workspace, expectedRevision),
      )
      .with({ type: 'review-snapshot' }, ({ definitionId, enabled, expectedRevision }) =>
        service.review(workspace, definitionId, enabled, expectedRevision),
      )
      .with({ type: 'skip-preparation' }, ({ phase, expectedRevision }) =>
        service.skip(workspace, phase, expectedRevision),
      )
      .with({ type: 'run-preparation' }, ({ phase, expectedRevision }) =>
        phase === 'cleanup'
          ? Effect.fail(new Error('Cleanup runs when the managed worktree is removed.'))
          : service.startSetup(workspace, expectedRevision),
      )
      .exhaustive()
  }).pipe(Effect.map((preparation) => ({ type: 'preparation', preparation }) as const))
}
