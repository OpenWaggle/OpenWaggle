import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionDeletionRecord } from '../../store/session-details/session-deletion-journal'
import type { CheckpointRefSnapshot } from '../git/turn-checkpoint-refs'

const {
  deleteSessionMock,
  deleteTurnCheckpointRefsMock,
  abandonSessionDeletionMock,
  listPendingSessionDeletionsMock,
  markSessionDeletionExternalCleanupCompleteMock,
  markSessionPiFileCleanupCompleteMock,
  prepareSessionPiFileCleanupMock,
  prepareSessionDeletionMock,
  prepareSessionCheckpointRefCleanupMock,
  pruneSessionWorktreeMock,
  restoreTurnCheckpointRefsMock,
} = vi.hoisted(() => ({
  deleteSessionMock: vi.fn(async () => undefined),
  deleteTurnCheckpointRefsMock: vi.fn(
    async (
      _projectPath: string,
      _sessionId: string,
      beforeDelete?: (refs: readonly CheckpointRefSnapshot[]) => Promise<void>,
    ): Promise<readonly CheckpointRefSnapshot[]> => {
      await beforeDelete?.([])
      return []
    },
  ),
  abandonSessionDeletionMock: vi.fn(async () => undefined),
  listPendingSessionDeletionsMock: vi.fn(async (): Promise<SessionId[]> => []),
  markSessionDeletionExternalCleanupCompleteMock: vi.fn(async () => undefined),
  markSessionPiFileCleanupCompleteMock: vi.fn(async () => undefined),
  prepareSessionPiFileCleanupMock: vi.fn(async () => ({
    phase: 'pi-file-cleanup-pending' as const,
    resumed: true,
    piSessionFile: null,
    stagedPiSessionFile: null,
    checkpointRefs: [],
  })),
  prepareSessionDeletionMock: vi.fn(
    async (): Promise<SessionDeletionRecord> => ({
      phase: 'prepared' as const,
      resumed: false,
      piSessionFile: null,
      stagedPiSessionFile: null,
      checkpointRefs: [],
    }),
  ),
  prepareSessionCheckpointRefCleanupMock: vi.fn(async () => undefined),
  pruneSessionWorktreeMock: vi.fn(),
  restoreTurnCheckpointRefsMock: vi.fn(async () => undefined),
}))

vi.mock('../../store/session-details', () => ({
  getSessionDetail: vi.fn(async () => ({
    id: SessionId('session-managed'),
    projectPath: '/project',
    worktreePath: null,
  })),
  getBoundWorkspaceResource: vi.fn(async () => ({
    id: 'workspace-managed',
    projectPath: '/project',
    kind: 'managed-worktree',
    workingPath: '/project/.worktrees/session-managed',
  })),
  listSessionWorktreeRefs: vi.fn(async () => [
    {
      sessionId: 'session-managed',
      worktreePath: '/project/.worktrees/session-managed',
    },
  ]),
  clearSessionWorktree: vi.fn(async () => undefined),
  deleteSession: deleteSessionMock,
  abandonSessionDeletion: abandonSessionDeletionMock,
  listPendingSessionDeletions: listPendingSessionDeletionsMock,
  markSessionDeletionExternalCleanupComplete: markSessionDeletionExternalCleanupCompleteMock,
  markSessionPiFileCleanupComplete: markSessionPiFileCleanupCompleteMock,
  prepareSessionPiFileCleanup: prepareSessionPiFileCleanupMock,
  prepareSessionDeletion: prepareSessionDeletionMock,
  prepareSessionCheckpointRefCleanup: prepareSessionCheckpointRefCleanupMock,
}))

vi.mock('../../store/turn-checkpoints', () => ({
  listTurnCheckpoints: vi.fn(async () => []),
}))

vi.mock('../git/turn-checkpoint-refs', () => ({
  deleteSessionTurnCheckpointRefs: deleteTurnCheckpointRefsMock,
  restoreSessionTurnCheckpointRefs: restoreTurnCheckpointRefsMock,
}))

vi.mock('../../store/pinned-sessions', () => ({}))

vi.mock('../../services/git/session-worktree-prune', () => ({
  pruneSessionWorktree: pruneSessionWorktreeMock,
}))

import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SqliteSessionProjectionRepositoryLive } from '../sqlite-session-projection-repository'

function deleteManagedSession() {
  return Effect.runPromise(
    Effect.gen(function* () {
      const repository = yield* SessionProjectionRepository
      yield* repository.delete(SessionId('session-managed'))
    }).pipe(Effect.provide(SqliteSessionProjectionRepositoryLive)),
  )
}

function recoverPendingDeletions() {
  return Effect.runPromise(
    Effect.gen(function* () {
      const repository = yield* SessionProjectionRepository
      yield* repository.recoverPendingDeletions?.() ?? Effect.void
    }).pipe(Effect.provide(SqliteSessionProjectionRepositoryLive)),
  )
}

describe('SQLite Session projection deletion', () => {
  beforeEach(() => {
    deleteSessionMock.mockReset()
    deleteSessionMock.mockResolvedValue(undefined)
    deleteTurnCheckpointRefsMock.mockReset()
    deleteTurnCheckpointRefsMock.mockImplementation(
      async (_projectPath, _sessionId, beforeDelete) => {
        await beforeDelete?.([])
        return []
      },
    )
    pruneSessionWorktreeMock.mockReset()
    restoreTurnCheckpointRefsMock.mockReset()
    restoreTurnCheckpointRefsMock.mockResolvedValue(undefined)
    abandonSessionDeletionMock.mockReset()
    abandonSessionDeletionMock.mockResolvedValue(undefined)
    listPendingSessionDeletionsMock.mockReset()
    listPendingSessionDeletionsMock.mockResolvedValue([])
    markSessionDeletionExternalCleanupCompleteMock.mockReset()
    markSessionDeletionExternalCleanupCompleteMock.mockResolvedValue(undefined)
    markSessionPiFileCleanupCompleteMock.mockReset()
    markSessionPiFileCleanupCompleteMock.mockResolvedValue(undefined)
    prepareSessionPiFileCleanupMock.mockReset()
    prepareSessionPiFileCleanupMock.mockResolvedValue({
      phase: 'pi-file-cleanup-pending',
      resumed: true,
      piSessionFile: null,
      stagedPiSessionFile: null,
      checkpointRefs: [],
    })
    prepareSessionCheckpointRefCleanupMock.mockReset()
    prepareSessionCheckpointRefCleanupMock.mockResolvedValue(undefined)
    prepareSessionDeletionMock.mockReset()
    prepareSessionDeletionMock.mockResolvedValue({
      phase: 'prepared',
      resumed: false,
      piSessionFile: null,
      stagedPiSessionFile: null,
      checkpointRefs: [],
    })
  })

  it('keeps the Session discoverable when its managed worktree cannot be pruned', async () => {
    pruneSessionWorktreeMock.mockResolvedValue({
      status: 'retained',
      reason: 'worktree-removal-refused',
    })

    await expect(deleteManagedSession()).rejects.toThrow()
    expect(deleteSessionMock).not.toHaveBeenCalled()
    expect(restoreTurnCheckpointRefsMock).toHaveBeenCalledWith('/project', [])
    expect(abandonSessionDeletionMock).toHaveBeenCalledWith(SessionId('session-managed'))
  })

  it('deletes the Session only after workspace cleanup succeeds', async () => {
    pruneSessionWorktreeMock.mockResolvedValue({ status: 'ready-for-deletion' })

    await expect(deleteManagedSession()).resolves.toBeUndefined()
    expect(pruneSessionWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({ worktreePath: '/project/.worktrees/session-managed' }),
      expect.any(Object),
    )
    expect(deleteSessionMock).toHaveBeenCalledWith(SessionId('session-managed'))
  })

  it('retains every SQLite checkpoint when fallible Git ref cleanup is refused', async () => {
    pruneSessionWorktreeMock.mockResolvedValue({ status: 'ready-for-deletion' })
    deleteTurnCheckpointRefsMock.mockImplementationOnce(() => {
      throw new Error('git ref cleanup failed')
    })

    await expect(deleteManagedSession()).rejects.toThrow()
    expect(pruneSessionWorktreeMock).not.toHaveBeenCalled()
    expect(deleteSessionMock).not.toHaveBeenCalled()
  })

  it('journals completed external cleanup when the SQLite Session transaction fails', async () => {
    const removedRefs = [{ name: 'refs/openwaggle/checkpoint', objectId: 'abc123' }]
    pruneSessionWorktreeMock.mockResolvedValue({ status: 'ready-for-deletion' })
    deleteTurnCheckpointRefsMock.mockResolvedValueOnce(removedRefs)
    deleteSessionMock.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(deleteManagedSession()).rejects.toThrow()
    expect(markSessionDeletionExternalCleanupCompleteMock).toHaveBeenCalledWith(
      SessionId('session-managed'),
    )
    expect(restoreTurnCheckpointRefsMock).not.toHaveBeenCalled()
    expect(abandonSessionDeletionMock).not.toHaveBeenCalled()
  })

  it('resumes a journaled post-cleanup deletion without repeating external mutations', async () => {
    listPendingSessionDeletionsMock.mockResolvedValueOnce([SessionId('session-managed')])
    prepareSessionDeletionMock.mockResolvedValueOnce({
      phase: 'external-cleanup-complete',
      resumed: true,
      piSessionFile: null,
      stagedPiSessionFile: null,
      checkpointRefs: [],
    })

    await expect(recoverPendingDeletions()).resolves.toBeUndefined()

    expect(deleteTurnCheckpointRefsMock).not.toHaveBeenCalled()
    expect(pruneSessionWorktreeMock).not.toHaveBeenCalled()
    expect(deleteSessionMock).toHaveBeenCalledWith(SessionId('session-managed'))
  })

  it('resumes journaled Pi file cleanup before deleting the SQLite Session', async () => {
    listPendingSessionDeletionsMock.mockResolvedValueOnce([SessionId('session-managed')])
    prepareSessionDeletionMock.mockResolvedValueOnce({
      phase: 'pi-file-cleanup-pending',
      resumed: true,
      piSessionFile: null,
      stagedPiSessionFile: null,
      checkpointRefs: [],
    })

    await expect(recoverPendingDeletions()).resolves.toBeUndefined()

    expect(markSessionPiFileCleanupCompleteMock).toHaveBeenCalledWith(SessionId('session-managed'))
    expect(deleteSessionMock).toHaveBeenCalledWith(SessionId('session-managed'))
  })

  it('restores durably journaled checkpoint refs when resumed pruning is refused', async () => {
    const refs = [{ name: 'refs/openwaggle/checkpoint', objectId: 'abc123' }]
    listPendingSessionDeletionsMock.mockResolvedValueOnce([SessionId('session-managed')])
    prepareSessionDeletionMock.mockResolvedValueOnce({
      phase: 'checkpoint-ref-cleanup-pending',
      resumed: true,
      piSessionFile: null,
      stagedPiSessionFile: null,
      checkpointRefs: refs,
    })
    pruneSessionWorktreeMock.mockResolvedValue({
      status: 'retained',
      reason: 'worktree-removal-refused',
    })

    await expect(recoverPendingDeletions()).resolves.toBeUndefined()

    expect(restoreTurnCheckpointRefsMock).toHaveBeenCalledWith('/project', refs)
    expect(abandonSessionDeletionMock).toHaveBeenCalledWith(SessionId('session-managed'))
    expect(deleteSessionMock).not.toHaveBeenCalled()
  })
})
