/**
 * SQLite adapter for the SessionProjectionRepository port.
 *
 * Wraps the current session-backed UI projection store in Effect
 * values and provides a Layer that satisfies the SessionProjectionRepository tag.
 * Follows the same dynamic-import pattern as SettingsService.Live to defer
 * module-level side effects until runtime initialization.
 */

import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { Effect, Layer } from 'effect'
import { sessionTreeReferencesWorktreeVisualization } from '../application/worktree-visualization-retention'
import { SessionProjectionRepositoryError } from '../errors'
import {
  SessionProjectionRepository,
  type SessionProjectionRepositoryShape,
} from '../ports/session-projection-repository'
import { acquireSessionDeletionFence } from '../store/session-details/session-deletion-fence'

export function withDeletionFence<A, E, R>(id: SessionId, operation: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    repoOp('delete', () => acquireSessionDeletionFence(id)),
    () => operation,
    (release) => Effect.sync(release),
  )
}

type RepoOperation =
  | 'get'
  | 'getOptional'
  | 'getHiveRelations'
  | 'list'
  | 'listDetails'
  | 'create'
  | 'getDeletionBlocker'
  | 'delete'
  | 'archive'
  | 'unarchive'
  | 'listArchived'
  | 'updateTitle'
  | 'setWorktreePlan'
  | 'resetWorktreeSetup'
  | 'setAuthorizationMode'
  | 'establishLineage'
  | 'setDelegationState'
  | 'listTurnCheckpoints'
  | 'getTurnDiff'
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

function requireSessionProjection(id: SessionId, read: () => Promise<SessionDetail | null>) {
  return repoOp('get', read).pipe(
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
  )
}

export const SqliteSessionProjectionRepositoryLive = Effect.promise(async () => {
  const [store, turnCheckpoints, worktreePrune, pinnedSessions] = await Promise.all([
    import('../store/session-details'),
    import('../store/turn-checkpoints'),
    import('../services/git/session-worktree-prune'),
    import('../store/pinned-sessions'),
  ])
  const { pruneSessionWorktree } = worktreePrune
  const { deleteTurnCheckpointsForSession } = turnCheckpoints

  async function pruneWorktreeForSession(
    id: Parameters<typeof store.getSessionDetail>[0],
    reason: 'delete' | 'archive',
    knownSession?: Awaited<ReturnType<typeof store.getSessionDetail>>,
  ) {
    const session = knownSession === undefined ? await store.getSessionDetail(id) : knownSession
    if (!session) return
    if (reason === 'archive' && session.worktreePath) {
      const tree = await import('../store/sessions/session-tree').then(({ getSessionTree }) =>
        getSessionTree(id),
      )
      if (tree && sessionTreeReferencesWorktreeVisualization(tree, session.worktreePath)) {
        return
      }
    }
    await pruneSessionWorktree(
      {
        sessionId: String(id),
        projectPath: session.projectPath,
        worktreePath: session.worktreePath ?? null,
        reason,
      },
      {
        listWorktreeRefs: async () => {
          const refs = await store.listSessionWorktreeRefs()
          return refs.some(({ sessionId }) => sessionId === String(id))
            ? refs
            : [{ sessionId: String(id), worktreePath: session.worktreePath ?? null }, ...refs]
        },
        clearWorktree: (sessionId) => store.clearSessionWorktree(SessionId(sessionId)),
        deleteCheckpoints: async (sessionId) => {
          await deleteTurnCheckpointsForSession(SessionId(sessionId))
        },
      },
    )
  }

  return Layer.succeed(
    SessionProjectionRepository,
    SessionProjectionRepository.of({
      withDeletionFence,
      get: (id) => requireSessionProjection(id, () => store.getSessionDetail(id)),

      getOptional: (id) => repoOp('getOptional', () => store.getSessionDetail(id)),

      getHiveRelations: (id) => repoOp('getHiveRelations', () => store.getSessionHiveRelations(id)),

      list: (limit) => repoOp('list', () => store.listSessionSummaries(limit)),

      listDetails: (limit, offset) =>
        repoOp('listDetails', () => store.listSessionDetails(limit, offset)),

      create: (input) => repoOp('create', () => store.createSession(input)),

      getDeletionBlocker: (id) =>
        repoOp('getDeletionBlocker', () => store.getSessionDeletionBlocker(id)),

      delete: (id) =>
        repoOp('delete', async () => {
          const session = await store.getSessionDetail(id)
          // Commit the lineage-guarded delete before pruning, so a concurrent Worker cannot leave
          // a surviving Queen with a removed checkout after the atomic guard rejects the delete.
          await store.deleteSession(id)
          await pruneWorktreeForSession(id, 'delete', session)
        }),

      archive: (id) =>
        repoOp('archive', async () => {
          // Reversible, so the session's Turn history has to survive it.
          await pruneWorktreeForSession(id, 'archive')
          return store.archiveSession(id)
        }),

      unarchive: (id) => repoOp('unarchive', () => store.unarchiveSession(id)),

      listArchived: () => repoOp('listArchived', () => store.listArchivedSessions()),

      updateTitle: (id, title) => repoOp('updateTitle', () => store.updateSessionTitle(id, title)),

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

      establishLineage: (input) =>
        repoOp('establishLineage', () => store.establishSessionLineage(input)),

      setDelegationState: (id, state) =>
        repoOp('setDelegationState', () => store.setSessionDelegationState(id, state)),

      listTurnCheckpoints: (id) =>
        repoOp('listTurnCheckpoints', () => turnCheckpoints.listTurnCheckpoints(id)),

      getTurnDiff: (id, turnId) =>
        repoOp('getTurnDiff', () => turnCheckpoints.getTurnDiff(id, turnId)),

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
}).pipe(Layer.unwrapEffect)
