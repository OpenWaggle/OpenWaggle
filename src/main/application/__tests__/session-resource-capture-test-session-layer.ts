import type { SessionWorkspace } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionRepository } from '../../ports/session-repository'

export function sessionResourceTestSessionLayer(sessionWorkingPath?: string) {
  return Layer.succeed(
    SessionRepository,
    SessionRepository.of({
      list: () => Effect.succeed([]),
      listArchivedBranches: () => Effect.succeed([]),
      getTree: () => Effect.succeed(null),
      listResourceProjectionPage: () =>
        Effect.succeed({ nodes: [], throughCreatedOrder: null, hasMore: false }),
      getResourceProjectionNodes: () => Effect.succeed([]),
      getWorkspace: () =>
        Effect.succeed(
          sessionWorkingPath
            ? fromPartial<SessionWorkspace>({
                tree: {
                  session: {
                    projectPath: sessionWorkingPath,
                    environmentMode: 'local',
                  },
                },
                activeBranchId: null,
                activeNodeId: null,
                transcriptPath: [],
              })
            : null,
        ),
      persistSnapshot: () => Effect.void,
      updateRuntime: () => Effect.void,
      renameBranch: () => Effect.void,
      archiveBranch: () => Effect.void,
      restoreBranch: () => Effect.void,
      updateTreeUiState: () => Effect.void,
      recordActiveRun: () => Effect.void,
      clearActiveRun: () => Effect.void,
      clearInterruptedRuns: () => Effect.void,
      listActiveRunsForRecovery: () => Effect.succeed([]),
      markActiveRunInterrupted: () => Effect.void,
    }),
  )
}
