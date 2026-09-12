import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionDeletionRecord } from '../../store/session-details/session-deletion-journal'
import type { CheckpointRefSnapshot } from '../git/turn-checkpoint-refs'

const {
  commitSessionDeletionMock,
  deleteTurnCheckpointRefsMock,
  abandonSessionDeletionMock,
  getSessionDeletionMock,
  listPendingSessionDeletionsMock,
  markSessionDeletionExternalCleanupCompleteMock,
  markSessionPiFileCleanupCompleteMock,
  prepareSessionPiFileCleanupMock,
  prepareSessionDeletionMock,
  prepareSessionCheckpointRefCleanupMock,
  pruneSessionWorktreeMock,
  restoreTurnCheckpointRefsMock,
} = vi.hoisted(() => ({
  commitSessionDeletionMock: vi.fn(),
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
  getSessionDeletionMock: vi.fn(async () => null),
  listPendingSessionDeletionsMock: vi.fn(async (): Promise<SessionId[]> => []),
  markSessionDeletionExternalCleanupCompleteMock: vi.fn(async () => undefined),
  markSessionPiFileCleanupCompleteMock: vi.fn(async () => undefined),
  prepareSessionPiFileCleanupMock: vi.fn(async () => ({
    phase: 'pi-file-cleanup-pending' as const,
    resumed: true,
    piSessionFile: null,
    stagedPiSessionFile: null,
    projectPath: '/project',
    worktreeProjectPath: '/project',
    worktreePath: '/project/.worktrees/session-managed',
    checkpointRefs: [],
  })),
  prepareSessionDeletionMock: vi.fn(
    async (): Promise<SessionDeletionRecord> => ({
      phase: 'prepared' as const,
      resumed: false,
      piSessionFile: null,
      stagedPiSessionFile: null,
      projectPath: '/project',
      worktreeProjectPath: '/project',
      worktreePath: '/project/.worktrees/session-managed',
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
  commitSessionDeletion: commitSessionDeletionMock,
  getSessionDeletion: getSessionDeletionMock,
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
    commitSessionDeletionMock.mockReset()
    commitSessionDeletionMock.mockResolvedValue({
      phase: 'durable-delete-complete',
      resumed: true,
      piSessionFile: null,
      stagedPiSessionFile: null,
      projectPath: '/project',
      worktreeProjectPath: '/project',
      worktreePath: '/project/.worktrees/session-managed',
      checkpointRefs: [],
    })
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
    getSessionDeletionMock.mockReset()
    getSessionDeletionMock.mockResolvedValue(null)
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
      projectPath: '/project',
      worktreeProjectPath: '/project',
      worktreePath: '/project/.worktrees/session-managed',
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
      projectPath: '/project',
      worktreeProjectPath: '/project',
      worktreePath: '/project/.worktrees/session-managed',
      checkpointRefs: [],
    })
  })

  it('keeps the Session discoverable when worktree safety validation refuses deletion', async () => {
    pruneSessionWorktreeMock.mockResolvedValue({
      status: 'retained',
      reason: 'worktree-removal-refused',
    })

    await expect(deleteManagedSession()).rejects.toThrow()
    expect(commitSessionDeletionMock).not.toHaveBeenCalled()
    expect(restoreTurnCheckpointRefsMock).not.toHaveBeenCalled()
    expect(abandonSessionDeletionMock).toHaveBeenCalledWith(SessionId('session-managed'))
  })

  it('commits Session deletion before workspace cleanup starts', async () => {
    pruneSessionWorktreeMock.mockResolvedValue({ status: 'ready-for-deletion' })

    await expect(deleteManagedSession()).resolves.toBeUndefined()
    expect(pruneSessionWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({ worktreePath: '/project/.worktrees/session-managed' }),
      expect.any(Object),
    )
    expect(commitSessionDeletionMock).toHaveBeenCalledWith(SessionId('session-managed'))
  })

  it('retains every SQLite checkpoint when fallible Git ref cleanup is refused', async () => {
    pruneSessionWorktreeMock.mockResolvedValue({ status: 'ready-for-deletion' })
    deleteTurnCheckpointRefsMock.mockImplementationOnce(() => {
      throw new Error('git ref cleanup failed')
    })

    await expect(deleteManagedSession()).rejects.toThrow()
    expect(pruneSessionWorktreeMock).toHaveBeenCalledOnce()
    expect(pruneSessionWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({ validateOnly: true }),
      expect.any(Object),
    )
    expect(commitSessionDeletionMock).toHaveBeenCalledOnce()
  })

  it('does not start external cleanup when the atomic SQLite deletion fails', async () => {
    pruneSessionWorktreeMock.mockResolvedValue({ status: 'ready-for-deletion' })
    commitSessionDeletionMock.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(deleteManagedSession()).rejects.toThrow()
    expect(deleteTurnCheckpointRefsMock).not.toHaveBeenCalled()
    expect(pruneSessionWorktreeMock).toHaveBeenCalledOnce()
    expect(pruneSessionWorktreeMock).toHaveBeenCalledWith(
      expect.objectContaining({ validateOnly: true }),
      expect.any(Object),
    )
    expect(abandonSessionDeletionMock).toHaveBeenCalledWith(SessionId('session-managed'))
  })

  it('resumes a journaled post-cleanup deletion without repeating external mutations', async () => {
    listPendingSessionDeletionsMock.mockResolvedValueOnce([SessionId('session-managed')])
    prepareSessionDeletionMock.mockResolvedValueOnce({
      phase: 'external-cleanup-complete',
      resumed: true,
      piSessionFile: null,
      stagedPiSessionFile: null,
      projectPath: '/project',
      worktreeProjectPath: '/project',
      worktreePath: '/project/.worktrees/session-managed',
      checkpointRefs: [],
    })

    await expect(recoverPendingDeletions()).resolves.toBeUndefined()

    expect(deleteTurnCheckpointRefsMock).not.toHaveBeenCalled()
    expect(pruneSessionWorktreeMock).not.toHaveBeenCalled()
    expect(commitSessionDeletionMock).not.toHaveBeenCalled()
  })

  it('resumes journaled Pi file cleanup before deleting the SQLite Session', async () => {
    listPendingSessionDeletionsMock.mockResolvedValueOnce([SessionId('session-managed')])
    prepareSessionDeletionMock.mockResolvedValueOnce({
      phase: 'pi-file-cleanup-pending',
      resumed: true,
      piSessionFile: null,
      stagedPiSessionFile: null,
      projectPath: '/project',
      worktreeProjectPath: '/project',
      worktreePath: '/project/.worktrees/session-managed',
      checkpointRefs: [],
    })

    await expect(recoverPendingDeletions()).resolves.toBeUndefined()

    expect(markSessionPiFileCleanupCompleteMock).toHaveBeenCalledWith(SessionId('session-managed'))
    expect(abandonSessionDeletionMock).toHaveBeenCalledWith(SessionId('session-managed'))
  })

  it('restores durably journaled checkpoint refs when resumed pruning is refused', async () => {
    const refs = [{ name: 'refs/openwaggle/checkpoint', objectId: 'abc123' }]
    listPendingSessionDeletionsMock.mockResolvedValueOnce([SessionId('session-managed')])
    prepareSessionDeletionMock.mockResolvedValueOnce({
      phase: 'checkpoint-ref-cleanup-pending',
      resumed: true,
      piSessionFile: null,
      stagedPiSessionFile: null,
      projectPath: '/project',
      worktreeProjectPath: '/project',
      worktreePath: '/project/.worktrees/session-managed',
      checkpointRefs: refs,
    })
    pruneSessionWorktreeMock.mockResolvedValue({
      status: 'retained',
      reason: 'worktree-removal-refused',
    })

    await expect(recoverPendingDeletions()).resolves.toBeUndefined()

    expect(restoreTurnCheckpointRefsMock).toHaveBeenCalledWith('/project', refs)
    expect(abandonSessionDeletionMock).not.toHaveBeenCalled()
    expect(commitSessionDeletionMock).not.toHaveBeenCalled()
  })
})
