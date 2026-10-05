import { formatErrorMessage } from '@shared/utils/node-error'
import { Effect, Layer } from 'effect'
import { SessionProjectionRepositoryError } from '../errors'
import { createLogger } from '../logger'
import {
  type PersistSessionSnapshotInput,
  SessionRepository,
  type SessionRepositoryShape,
} from '../ports/session-repository'
import {
  SessionTranscriptRepair,
  type SessionTranscriptRepairShape,
} from '../ports/session-transcript-repair'
import { unwrapFiberFailure } from '../utils/describe-error'

const logger = createLogger('session-repository')

async function loadSessionRepositoryStores() {
  // Independent dynamic imports — load them concurrently.
  const [store, sessionDetailStore, { withSessionLock }] = await Promise.all([
    import('../store/sessions'),
    import('../store/session-details'),
    import('../store/session-lock'),
  ])

  return { store, sessionDetailStore, withSessionLock }
}

type SessionRepositoryStores = Awaited<ReturnType<typeof loadSessionRepositoryStores>> & {
  readonly transcriptRepair: SessionTranscriptRepairShape
}

function repositoryOperation<T>(operation: string, task: () => Promise<T>) {
  return Effect.tryPromise({
    try: task,
    catch: (cause) => new SessionProjectionRepositoryError({ operation, cause }),
  })
}

function createSessionReadMethods(deps: SessionRepositoryStores) {
  return {
    list: (limit) => repositoryOperation('listSessions', () => deps.store.listSessions(limit)),
    listCatalogPage: (archived, limit, cursor) =>
      repositoryOperation('listSessionCatalogPage', () =>
        deps.store.listSessionCatalogPage(archived, limit, cursor),
      ),
    listProjectPage: (limit, cursor, search, matchingDisplayNamePaths) =>
      repositoryOperation('listSessionProjectPage', () =>
        deps.store.listSessionProjectPage(limit, cursor, search, matchingDisplayNamePaths),
      ),
    hasActiveProjectPath: (paths) =>
      repositoryOperation('hasActiveSessionProjectPath', () =>
        deps.store.hasActiveSessionProjectPath(paths),
      ),
    listByIds: (sessionIds) =>
      repositoryOperation('listSessionsByIds', () => deps.store.listSessionsByIds(sessionIds)),
    listHiveCatalogPage: (sessionId, limit, cursor) =>
      repositoryOperation('listHiveSessionCatalogPage', () =>
        deps.store.listHiveSessionCatalogPage(sessionId, limit, cursor),
      ),
    listArchivedBranchCatalogPage: (limit, cursor) =>
      repositoryOperation('listArchivedSessionBranchCatalogPage', () =>
        deps.store.listArchivedSessionBranchCatalogPage(limit, cursor),
      ),
    listArchivedBranches: (limit) =>
      repositoryOperation('listArchivedSessionBranches', () =>
        deps.store.listArchivedSessionBranches(limit),
      ),
    getTree: (sessionId) =>
      repositoryOperation('getSessionTree', () => deps.store.getSessionTree(sessionId)),
    listResourceProjectionPage: (sessionId, afterCreatedOrder, limit) =>
      repositoryOperation('listSessionResourceProjectionPage', () =>
        deps.store.listSessionResourceProjectionPage(sessionId, afterCreatedOrder, limit),
      ),
    getResourceProjectionNodes: (sessionId, nodeIds) =>
      repositoryOperation('getSessionResourceProjectionNodes', () =>
        deps.store.getSessionResourceProjectionNodes(sessionId, nodeIds),
      ),
    getWorkspace: (sessionId, selection) =>
      repositoryOperation('getSessionWorkspace', () =>
        deps.store.getSessionWorkspace(sessionId, selection),
      ),
    listActiveRunsForRecovery: () =>
      repositoryOperation('listSessionActiveRunsForRecovery', () =>
        deps.store.listSessionActiveRunsForRecovery(),
      ),
  } satisfies Pick<
    SessionRepositoryShape,
    | 'list'
    | 'listCatalogPage'
    | 'listProjectPage'
    | 'hasActiveProjectPath'
    | 'listByIds'
    | 'listHiveCatalogPage'
    | 'listArchivedBranchCatalogPage'
    | 'listArchivedBranches'
    | 'getTree'
    | 'listResourceProjectionPage'
    | 'getResourceProjectionNodes'
    | 'getWorkspace'
    | 'listActiveRunsForRecovery'
  >
}

/**
 * Saves a snapshot, first renaming Pi entries whose ids another Session already holds.
 *
 * Such a snapshot can never be saved as it is, and every later snapshot of the Session would
 * fail the same way; see {@link SessionTranscriptRepair}. The repair runs under the Session lock,
 * after the run or operation that produced the snapshot has released its agent session. When the
 * transcript cannot be repaired, the repair failure is logged and the named conflict is rethrown.
 */
async function persistSnapshotRepairingEntryIds(
  deps: SessionRepositoryStores,
  input: PersistSessionSnapshotInput,
) {
  try {
    await deps.sessionDetailStore.persistSessionSnapshot(input)
    return
  } catch (error) {
    const failure = unwrapFiberFailure(error)
    if (!(failure instanceof deps.sessionDetailStore.SessionNodeIdConflictError)) throw error
    const repair = await Effect.runPromise(
      Effect.either(
        deps.transcriptRepair.renameForeignEntryIds(
          input,
          new Set(failure.conflicts.map((conflict) => conflict.nodeId)),
        ),
      ),
    )
    if (repair._tag === 'Left' || !repair.right) {
      logger.error('Could not rename transcript entries whose ids belong to other Sessions', {
        sessionId: input.sessionId,
        piSessionFile: input.piSessionFile,
        conflictCount: failure.conflicts.length,
        conflicts: failure.conflicts.slice(0, deps.sessionDetailStore.MAX_NAMED_CONFLICTS),
        ...(repair._tag === 'Left' ? { error: formatErrorMessage(repair.left.cause) } : {}),
      })
      throw failure
    }
    const repaired = repair.right
    logger.warn('Renamed transcript entries whose ids belong to other Sessions', {
      sessionId: input.sessionId,
      piSessionFile: input.piSessionFile,
      conflictCount: failure.conflicts.length,
      conflicts: failure.conflicts.slice(0, deps.sessionDetailStore.MAX_NAMED_CONFLICTS),
    })
    await deps.sessionDetailStore.persistSessionSnapshot(repaired)
  }
}

function createSessionDetailMethods(deps: SessionRepositoryStores) {
  return {
    persistSnapshot: (input) =>
      repositoryOperation('persistSessionSnapshot', () =>
        deps.withSessionLock(input.sessionId, () => persistSnapshotRepairingEntryIds(deps, input)),
      ),
    updateRuntime: (input) =>
      repositoryOperation('updateSessionRuntime', () =>
        deps.sessionDetailStore.updateSessionRuntime(input),
      ),
  } satisfies Pick<SessionRepositoryShape, 'persistSnapshot' | 'updateRuntime'>
}
function createSessionBranchMethods(deps: SessionRepositoryStores) {
  return {
    renameBranch: (sessionId, branchId, name) =>
      repositoryOperation('renameSessionBranch', () =>
        deps.store.renameSessionBranch(sessionId, branchId, name),
      ),
    archiveBranch: (sessionId, branchId) =>
      repositoryOperation('archiveSessionBranch', () =>
        deps.store.archiveSessionBranch(sessionId, branchId),
      ),
    restoreBranch: (sessionId, branchId) =>
      repositoryOperation('restoreSessionBranch', () =>
        deps.store.restoreSessionBranch(sessionId, branchId),
      ),
    updateTreeUiState: (sessionId, patch) =>
      repositoryOperation('updateSessionTreeUiState', () =>
        deps.store.updateSessionTreeUiState(sessionId, patch),
      ),
  } satisfies Pick<
    SessionRepositoryShape,
    'renameBranch' | 'archiveBranch' | 'restoreBranch' | 'updateTreeUiState'
  >
}

function createActiveRunMethods(deps: SessionRepositoryStores) {
  return {
    recordActiveRun: (input) =>
      repositoryOperation('recordSessionActiveRun', () => deps.store.recordSessionActiveRun(input)),
    clearActiveRun: (input) =>
      repositoryOperation('clearSessionActiveRun', () => deps.store.clearSessionActiveRun(input)),
    clearInterruptedRuns: (input) =>
      repositoryOperation('clearInterruptedSessionRuns', () =>
        deps.store.clearInterruptedSessionRuns(input),
      ),
    markActiveRunInterrupted: (input) =>
      repositoryOperation('markSessionActiveRunInterrupted', () =>
        deps.store.markSessionActiveRunInterrupted(input),
      ),
  } satisfies Pick<
    SessionRepositoryShape,
    'recordActiveRun' | 'clearActiveRun' | 'clearInterruptedRuns' | 'markActiveRunInterrupted'
  >
}

function createSessionRepositoryShape(deps: SessionRepositoryStores): SessionRepositoryShape {
  return {
    ...createSessionReadMethods(deps),
    ...createSessionDetailMethods(deps),
    ...createSessionBranchMethods(deps),
    ...createActiveRunMethods(deps),
  }
}

export const SqliteSessionRepositoryLive = Effect.gen(function* () {
  const transcriptRepair = yield* SessionTranscriptRepair
  const stores = yield* Effect.promise(loadSessionRepositoryStores)
  const deps = { ...stores, transcriptRepair }
  return Layer.succeed(SessionRepository, SessionRepository.of(createSessionRepositoryShape(deps)))
}).pipe(Layer.unwrapEffect)
