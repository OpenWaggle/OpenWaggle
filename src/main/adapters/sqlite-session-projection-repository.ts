/**
 * SQLite adapter for the SessionProjectionRepository port.
 *
 * Wraps the current session-backed UI projection store in Effect
 * values and provides a Layer that satisfies the SessionProjectionRepository tag.
 * Follows the same dynamic-import pattern as SettingsService.Live to defer
 * module-level side effects until runtime initialization.
 */

import { SessionId } from '@shared/types/brand'
import { Effect, Layer } from 'effect'
import { SessionProjectionRepositoryError } from '../errors'
import {
  SessionProjectionRepository,
  type SessionProjectionRepositoryShape,
} from '../ports/session-projection-repository'

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
  | 'setAuthorizationMode'
  | 'listTurnCheckpoints'
  | 'getTurnDiff'
  | 'setTurnCheckpointAnchor'

function repoOp<A>(operation: RepoOperation, thunk: () => Promise<A>) {
  return Effect.tryPromise({
    try: thunk,
    catch: (cause: unknown) => new SessionProjectionRepositoryError({ operation, cause }),
  })
}

export const SqliteSessionProjectionRepositoryLive = Effect.promise(async () => {
  const [store, turnCheckpoints, worktreePrune] = await Promise.all([
    import('../store/session-details'),
    import('../store/turn-checkpoints'),
    import('../ipc/git/session-worktree-prune'),
  ])
  const { pruneSessionWorktree } = worktreePrune
  const { deleteTurnCheckpointsForSession } = turnCheckpoints

  async function pruneWorktreeForSession(id: Parameters<typeof store.getSessionDetail>[0]) {
    const session = await store.getSessionDetail(id)
    if (!session) return
    await pruneSessionWorktree(
      {
        sessionId: String(id),
        projectPath: session.projectPath,
        worktreePath: session.worktreePath ?? null,
      },
      {
        listWorktreeRefs: () => store.listSessionWorktreeRefs(),
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

      delete: (id) =>
        repoOp('delete', async () => {
          await pruneWorktreeForSession(id)
          return store.deleteSession(id)
        }),

      archive: (id) =>
        repoOp('archive', async () => {
          await pruneWorktreeForSession(id)
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

      setAuthorizationMode: (id, mode) =>
        repoOp('setAuthorizationMode', () => store.setSessionAuthorizationMode(id, mode)),

      listTurnCheckpoints: (id) =>
        repoOp('listTurnCheckpoints', () => turnCheckpoints.listTurnCheckpoints(id)),

      getTurnDiff: (id, turnId) =>
        repoOp('getTurnDiff', () => turnCheckpoints.getTurnDiff(id, turnId)),

      setTurnCheckpointAnchor: (id, turnId, anchorNodeId) =>
        repoOp('setTurnCheckpointAnchor', () =>
          turnCheckpoints.setTurnCheckpointAnchor(id, turnId, anchorNodeId),
        ),
    } satisfies SessionProjectionRepositoryShape),
  )
}).pipe(Layer.unwrapEffect)
