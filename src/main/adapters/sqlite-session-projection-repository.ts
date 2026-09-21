import { removePreparedWorktree } from '../application/prepared-worktree-removal'
import type { ActionRunServiceShape } from '../ports/action-run-service'
import { ActionRunService } from '../ports/action-run-service'
import type { SessionWorkspaceResourceRepositoryShape } from '../ports/session-workspace-resource-repository'
import { SessionWorkspaceResourceRepository } from '../ports/session-workspace-resource-repository'
import type { WorkspacePreparationServiceShape } from '../ports/workspace-preparation-service'
import { WorkspacePreparationService } from '../ports/workspace-preparation-service'
import { removeGitWorktree } from './git/worktree'
/**
 * SQLite adapter for the SessionProjectionRepository port.
 *
 * Wraps the current session-backed UI projection store in Effect
 * values and provides a Layer that satisfies the SessionProjectionRepository tag.
 * Follows the same dynamic-import pattern as SettingsService.Live to defer
 * module-level side effects until runtime initialization.
 */

import { Effect, Layer } from 'effect'
import { sessionTreeReferencesWorktreeVisualization } from '../application/worktree-visualization-retention'
import { SessionProjectionRepositoryError } from '../errors'
import {
  SessionProjectionRepository,
  type SessionProjectionRepositoryShape,
} from '../ports/session-projection-repository'
import {
  archiveSessionWorkspace,
  createSessionProjectionDeletionMethods,
} from './sqlite-session-projection-deletion'

type RepoOperation =
  | 'get'
  | 'getOptional'
  | 'list'
  | 'listDetails'
  | 'create'
  | 'delete'
  | 'archive'
  | 'unarchive'
  | 'listArchived'
  | 'updateTitle'
  | 'setWorktreePlan'
  | 'resetWorktreeSetup'
  | 'setAuthorizationMode'
  | 'listTurnCheckpoints'
  | 'getTurnDiff'
  | 'getTurnDiffFiles'
  | 'setTurnCheckpointAnchor'
  | 'listPinnedSessions'
  | 'pinSession'
  | 'unpinSession'
  | 'movePinnedSession'

function repoOp<A>(operation: RepoOperation, thunk: () => Promise<A>) {
  return Effect.tryPromise({
    try: thunk,
    catch: (cause: unknown) => new SessionProjectionRepositoryError({ operation, cause }),
  })
}

function createPreparedWorktreeRemover({
  actions,
  preparation,
  workspaces,
}: {
  readonly actions: ActionRunServiceShape
  readonly preparation: WorkspacePreparationServiceShape
  readonly workspaces: SessionWorkspaceResourceRepositoryShape
}) {
  return (
    projectPath: string,
    payload: Parameters<typeof removeGitWorktree>[1],
    recovering: boolean,
  ) =>
    Effect.runPromise(
      removePreparedWorktree(
        projectPath,
        payload,
        Effect.tryPromise({
          try: () => removeGitWorktree(projectPath, payload),
          catch: (error) => new Error('Worktree removal failed.', { cause: error }),
        }),
        { retryFailed: !recovering, actionFenceHeld: !recovering },
      ).pipe(
        Effect.provideService(ActionRunService, actions),
        Effect.provideService(WorkspacePreparationService, preparation),
        Effect.provideService(SessionWorkspaceResourceRepository, workspaces),
      ),
    )
}

export const SqliteSessionProjectionRepositoryLive = Effect.gen(function* () {
  const actions = yield* ActionRunService
  const preparation = yield* WorkspacePreparationService
  const workspaces = yield* SessionWorkspaceResourceRepository
  return yield* Effect.promise(async () => {
    const [store, turnCheckpoints, worktreePrune, checkpointRefs, pinnedSessions] =
      await Promise.all([
        import('../store/session-details'),
        import('../store/turn-checkpoints'),
        import('../services/git/session-worktree-prune'),
        import('./git/turn-checkpoint-refs'),
        import('../store/pinned-sessions'),
      ])
    const { pruneSessionWorktree } = worktreePrune
    const { deleteSessionTurnCheckpointRefs, restoreSessionTurnCheckpointRefs } = checkpointRefs
    const deletion = {
      store,
      removeWorktree: createPreparedWorktreeRemover({ actions, preparation, workspaces }),
      pruneSessionWorktree,
      deleteCheckpointRefs: deleteSessionTurnCheckpointRefs,
      restoreCheckpointRefs: restoreSessionTurnCheckpointRefs,
    }

    async function archiveWorkspaceUnlessVisualizationRetained(
      id: Parameters<typeof store.getSessionDetail>[0],
    ) {
      const session = await store.getSessionDetail(id)
      if (!session) return
      if (session.worktreePath) {
        const tree = await import('../store/sessions/session-tree').then(({ getSessionTree }) =>
          getSessionTree(id),
        )
        if (tree && sessionTreeReferencesWorktreeVisualization(tree, session.worktreePath)) {
          return
        }
      }
      await archiveSessionWorkspace(deletion, id)
    }

    return Layer.succeed(
      SessionProjectionRepository,
      SessionProjectionRepository.of({
        get: (id) =>
          Effect.tryPromise({
            try: () => store.getSessionDetail(id),
            catch: (cause) => new SessionProjectionRepositoryError({ operation: 'get', cause }),
          }).pipe(
            Effect.flatMap((session) =>
              session
                ? Effect.succeed(session)
                : Effect.fail(
                    new SessionProjectionRepositoryError({
                      operation: 'get',
                      cause: `Session projection ${id} not found`,
                    }),
                  ),
            ),
          ),

        getOptional: (id) => repoOp('getOptional', () => store.getSessionDetail(id)),

        list: (limit) => repoOp('list', () => store.listSessionSummaries(limit)),

        listDetails: (limit, offset) =>
          repoOp('listDetails', () => store.listSessionDetails(limit, offset)),

        create: (input) => repoOp('create', () => store.createSession(input)),

        ...createSessionProjectionDeletionMethods(deletion),

        archive: (id) =>
          repoOp('archive', async () => {
            // Reversible, so the session's Turn history has to survive it.
            await archiveWorkspaceUnlessVisualizationRetained(id)
            return store.archiveSession(id)
          }),

        unarchive: (id) => repoOp('unarchive', () => store.unarchiveSession(id)),

        listArchived: () => repoOp('listArchived', () => store.listArchivedSessions()),

        updateTitle: (id, title) =>
          repoOp('updateTitle', () => store.updateSessionTitle(id, title)),

        setWorktreePlan: (id, plan) =>
          repoOp('setWorktreePlan', () =>
            store.setSessionWorktreePlan(
              id,
              plan.environmentMode,
              plan.baseRef,
              plan.startFromOrigin,
            ),
          ),

        resetWorktreeSetup: (id, worktreePath) =>
          repoOp('resetWorktreeSetup', async () => {
            const pending = await store.resetRecordedSessionWorktreeSetup(id, worktreePath)
            if (!pending) {
              throw new Error('The Session does not own this recorded worktree path.')
            }
          }),

        setAuthorizationMode: (id, mode) =>
          repoOp('setAuthorizationMode', () => store.setSessionAuthorizationMode(id, mode)),

        listTurnCheckpoints: (id) =>
          repoOp('listTurnCheckpoints', () => turnCheckpoints.listTurnCheckpoints(id)),

        getTurnDiff: (id, turnId) =>
          repoOp('getTurnDiff', () => turnCheckpoints.getTurnDiff(id, turnId)),

        getTurnDiffFiles: (id, turnId) =>
          repoOp('getTurnDiffFiles', () => turnCheckpoints.getTurnDiffFiles(id, turnId)),

        setTurnCheckpointAnchor: (id, turnId, anchorNodeId) =>
          repoOp('setTurnCheckpointAnchor', () =>
            turnCheckpoints.setTurnCheckpointAnchor(id, turnId, anchorNodeId),
          ),

        listPinnedSessions: () =>
          repoOp('listPinnedSessions', () => pinnedSessions.listPinnedSessions()),

        pinSession: (id) => repoOp('pinSession', () => pinnedSessions.pinSession(id)),

        unpinSession: (id) => repoOp('unpinSession', () => pinnedSessions.unpinSession(id)),

        movePinnedSession: (move) =>
          repoOp('movePinnedSession', () => pinnedSessions.movePinnedSession(move)),
      } satisfies SessionProjectionRepositoryShape),
    )
  })
}).pipe(Layer.unwrapEffect)
