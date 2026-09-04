import { SessionId } from '@shared/types/brand'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { InlineVisualizationService } from '../../ports/inline-visualization-service'
import { SessionRepository } from '../../ports/session-repository'
import { readInlineVisualizationSource } from '../inline-visualization-source-service'

const sessionId = SessionId('visualization-worktree-session')
const readSource = vi.fn(() =>
  Effect.succeed({ status: 'loaded', contents: '<main>Worktree</main>', sizeBytes: 21 } as const),
)

const SessionLayer = Layer.succeed(SessionRepository, {
  list: () => Effect.succeed([]),
  listArchivedBranches: () => Effect.succeed([]),
  getTree: () =>
    Effect.succeed({
      session: {
        id: sessionId,
        title: 'Worktree visualization',
        projectPath: '/opened-checkout',
        createdAt: 1,
        updatedAt: 1,
        environmentMode: 'worktree',
        worktreePath: '/session-worktree',
      },
      nodes: [],
      branches: [],
      branchStates: [],
      uiState: null,
    }),
  listResourceProjectionPage: () =>
    Effect.succeed({ nodes: [], throughCreatedOrder: null, hasMore: false }),
  getResourceProjectionNodes: () => Effect.succeed([]),
  getWorkspace: () => Effect.succeed(null),
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
})

const VisualizationLayer = Layer.succeed(InlineVisualizationService, {
  prepareSession: () => Effect.dieMessage('prepareSession is not used'),
  deleteSession: () => Effect.dieMessage('deleteSession is not used'),
  stageSessionDeletion: () => Effect.dieMessage('stageSessionDeletion is not used'),
  readSource,
})

describe('readInlineVisualizationSource', () => {
  it('authorizes the effective session worktree without exposing the opened checkout', async () => {
    const sourcePath = '/session-worktree/.openwaggle/visualizations/map.html'

    const result = await Effect.runPromise(
      readInlineVisualizationSource({ sessionId, sourcePath }).pipe(
        Effect.provide(Layer.merge(SessionLayer, VisualizationLayer)),
      ),
    )

    expect(result).toMatchObject({ status: 'loaded' })
    expect(readSource).toHaveBeenCalledWith({
      sessionId,
      sourcePath,
      workspaceRoots: ['/session-worktree'],
    })
  })
})
