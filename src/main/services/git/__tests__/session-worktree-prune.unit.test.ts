import type { GitWorktreeMutationResult } from '@shared/types/git'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionWorktreeRef } from '../worktree-cleanup'

const { removeGitWorktreeMock, validateGitWorktreeRemovalMock } = vi.hoisted(() => ({
  removeGitWorktreeMock: vi.fn(
    async (): Promise<GitWorktreeMutationResult> => ({
      ok: true,
      message: 'removed',
      path: '/wt/x',
    }),
  ),
  validateGitWorktreeRemovalMock: vi.fn(
    async (): Promise<GitWorktreeMutationResult> => ({
      ok: true,
      message: 'safe',
      path: '/wt/x',
    }),
  ),
}))

vi.mock('../../../adapters/git/worktree', () => ({
  removeGitWorktree: removeGitWorktreeMock,
  validateGitWorktreeRemoval: validateGitWorktreeRemovalMock,
}))

const { pruneSessionWorktree } = await import('../session-worktree-prune')

function deps(refs: SessionWorktreeRef[]) {
  return {
    listWorktreeRefs: vi.fn(async () => refs),
    clearWorktree: vi.fn(async () => {}),
  }
}

describe('pruneSessionWorktree', () => {
  beforeEach(() => {
    removeGitWorktreeMock.mockReset()
    removeGitWorktreeMock.mockResolvedValue({ ok: true, message: 'removed', path: '/wt/x' })
    validateGitWorktreeRemovalMock.mockReset()
    validateGitWorktreeRemovalMock.mockResolvedValue({ ok: true, message: 'safe', path: '/wt/x' })
  })

  it('removes the worktree when the session solely owns it, then clears its legacy path', async () => {
    const d = deps([{ sessionId: 's1', worktreePath: '/wt/x' }])
    const result = await pruneSessionWorktree(
      { sessionId: 's1', projectPath: '/repo', worktreePath: '/wt/x', reason: 'delete' },
      d,
    )
    expect(result).toEqual({ status: 'ready-for-deletion' })
    expect(removeGitWorktreeMock).toHaveBeenCalledWith('/repo', { path: '/wt/x' })
    expect(d.clearWorktree).toHaveBeenCalledWith('s1')
  })

  it('does not remove a worktree shared by another session', async () => {
    const d = deps([
      { sessionId: 's1', worktreePath: '/wt/shared' },
      { sessionId: 's2', worktreePath: '/wt/shared' },
    ])
    await pruneSessionWorktree(
      { sessionId: 's1', projectPath: '/repo', worktreePath: '/wt/shared', reason: 'delete' },
      d,
    )
    expect(removeGitWorktreeMock).not.toHaveBeenCalled()
    expect(d.clearWorktree).toHaveBeenCalledWith('s1')
  })

  it('validates deletion safety without changing Git or SQLite state', async () => {
    const d = deps([{ sessionId: 's1', worktreePath: '/wt/x' }])

    await expect(
      pruneSessionWorktree(
        {
          sessionId: 's1',
          projectPath: '/repo',
          worktreePath: '/wt/x',
          reason: 'delete',
          validateOnly: true,
        },
        d,
      ),
    ).resolves.toEqual({ status: 'ready-for-deletion' })

    expect(validateGitWorktreeRemovalMock).toHaveBeenCalledWith('/repo', { path: '/wt/x' })
    expect(removeGitWorktreeMock).not.toHaveBeenCalled()
    expect(d.clearWorktree).not.toHaveBeenCalled()
  })

  it('does not mutate worktree state when the session has no worktree', async () => {
    const d = deps([])
    await pruneSessionWorktree(
      { sessionId: 's1', projectPath: '/repo', worktreePath: null, reason: 'delete' },
      d,
    )
    expect(removeGitWorktreeMock).not.toHaveBeenCalled()
    expect(d.clearWorktree).not.toHaveBeenCalled()
  })

  it('returns a retained result when removal fails', async () => {
    removeGitWorktreeMock.mockResolvedValue({ ok: false, code: 'dirty-worktree', message: 'dirty' })
    const d = deps([{ sessionId: 's1', worktreePath: '/wt/x' }])
    await expect(
      pruneSessionWorktree(
        { sessionId: 's1', projectPath: '/repo', worktreePath: '/wt/x', reason: 'delete' },
        d,
      ),
    ).resolves.toEqual({ status: 'retained', reason: 'worktree-removal-refused' })
  })

  it('accepts an already-removed worktree only while resuming a durable deletion', async () => {
    removeGitWorktreeMock.mockResolvedValue({ ok: false, code: 'not-found', message: 'missing' })
    const d = deps([{ sessionId: 's1', worktreePath: '/wt/x' }])

    const result = await pruneSessionWorktree(
      {
        sessionId: 's1',
        projectPath: '/repo',
        worktreePath: '/wt/x',
        reason: 'delete',
        allowMissingWorktree: true,
      },
      d,
    )

    expect(result).toEqual({ status: 'ready-for-deletion' })
    expect(d.clearWorktree).toHaveBeenCalledWith('s1')
  })

  it('keeps the worktree binding when removal fails, so uncommitted work stays reachable', async () => {
    /*
     * Removal is deliberately not forced, so git refuses a worktree holding uncommitted work
     * (verified against real git: "contains modified or untracked files, use --force to delete
     * it", exit 128). Clearing the binding anyway orphaned that work - the tree stayed on disk
     * while the app forgot where it was, with only a log line to say so. This assertion
     * replaces one that pinned the old behaviour.
     */
    removeGitWorktreeMock.mockResolvedValue({
      ok: false,
      code: 'dirty-worktree',
      message: 'contains modified or untracked files',
    })
    const d = deps([{ sessionId: 's1', worktreePath: '/wt/x' }])

    const result = await pruneSessionWorktree(
      { sessionId: 's1', projectPath: '/repo', worktreePath: '/wt/x', reason: 'delete' },
      d,
    )

    expect(d.clearWorktree).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'retained', reason: 'worktree-removal-refused' })
  })

  it('keeps Turn checkpoints and their anchor refs when a session is archived', async () => {
    /*
     * Archiving is reversible - `unarchive` exists and only flips a flag - but checkpoints and the
     * whole anchor-ref namespace were deleted for both reasons, so an archived session came back with
     * its entire turn-diff history gone and its snapshot objects unpinned.
     */
    const d = deps([{ sessionId: 's1', worktreePath: '/wt/x' }])

    await pruneSessionWorktree(
      { sessionId: 's1', projectPath: '/repo', worktreePath: '/wt/x', reason: 'archive' },
      d,
    )

    /*
     * And the worktree stays. `git worktree remove` refuses on modified or untracked content, but
     * ignored content is not dirty - `.env`, `node_modules`, build caches are deleted with the
     * directory, and recreating the tree from its branch cannot restore any of it. Too destructive for
     * a reversible action.
     */
    expect(removeGitWorktreeMock).not.toHaveBeenCalled()
    expect(d.clearWorktree).not.toHaveBeenCalled()
  })
})
