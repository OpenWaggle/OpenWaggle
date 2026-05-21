import { Effect, Layer } from 'effect'
import { SessionProjectionRepositoryError } from '../errors'
import { SessionRepository, type SessionRepositoryShape } from '../ports/session-repository'

async function loadSessionRepositoryStores() {
  const store = await import('../store/sessions')
  const sessionDetailStore = await import('../store/session-details')
  const { withSessionLock } = await import('../store/session-lock')

  return { store, sessionDetailStore, withSessionLock }
}

type SessionRepositoryStores = Awaited<ReturnType<typeof loadSessionRepositoryStores>>

function repositoryOperation<T>(operation: string, task: () => Promise<T>) {
  return Effect.tryPromise({
    try: task,
    catch: (cause) => new SessionProjectionRepositoryError({ operation, cause }),
  })
}

function createSessionReadMethods(deps: SessionRepositoryStores) {
  return {
    list: (limit) => repositoryOperation('listSessions', () => deps.store.listSessions(limit)),
    listArchivedBranches: (limit) =>
      repositoryOperation('listArchivedSessionBranches', () =>
        deps.store.listArchivedSessionBranches(limit),
      ),
    getTree: (sessionId) =>
      repositoryOperation('getSessionTree', () => deps.store.getSessionTree(sessionId)),
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
    'list' | 'listArchivedBranches' | 'getTree' | 'getWorkspace' | 'listActiveRunsForRecovery'
  >
}

function createSessionDetailMethods(deps: SessionRepositoryStores) {
  return {
    persistSnapshot: (input) =>
      repositoryOperation('persistSessionSnapshot', () =>
        deps.withSessionLock(input.sessionId, () =>
          deps.sessionDetailStore.persistSessionSnapshot(input),
        ),
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

export const SqliteSessionRepositoryLive = Effect.promise(async () => {
  const deps = await loadSessionRepositoryStores()
  return Layer.succeed(SessionRepository, SessionRepository.of(createSessionRepositoryShape(deps)))
}).pipe(Layer.unwrapEffect)
