import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { EMPTY_PREPARATION_EXECUTION } from '../../adapters/project-actions/workspace-preparation-model'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import { WorkspacePreparationService } from '../../ports/workspace-preparation-service'

export const NoopWorkspacePreparationLayer = Layer.succeed(
  WorkspacePreparationService,
  fromPartial({
    capture: (workspace: ActionRunWorkspace) =>
      Effect.succeed({
        workspaceId: workspace.workspaceId,
        revision: 1,
        snapshot: { profile: { id: 'default', name: 'Default' }, capturedAt: 0, definitions: [] },
        setup: EMPTY_PREPARATION_EXECUTION,
        cleanup: EMPTY_PREPARATION_EXECUTION,
        updateAvailable: false,
      }),
    read: () => Effect.succeed(null),
    requireSetup: () => Effect.void,
    environment: () => Effect.succeed({}),
    recoverAfterHostLoss: Effect.void,
  }),
)
