import type { GitWorktreeMutationResult } from '@shared/types/git'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionWorktreeRef } from '../worktree-cleanup'

const { removeGitWorktreeMock, deleteRefsMock } = vi.hoisted(() => ({
  deleteRefsMock: vi.fn(async () => {}),
  removeGitWorktreeMock: vi.fn(
    async (): Promise<GitWorktreeMutationResult> => ({
      ok: true,
      message: 'removed',
      path: '/wt/x',
    }),
  ),
}))

vi.mock('../../../adapters/git/worktree', () => ({ removeGitWorktree: removeGitWorktreeMock }))
vi.mock('../../../adapters/git/turn-checkpoint-refs', () => ({
  deleteSessionTurnCheckpointRefs: deleteRefsMock,
}))

const { pruneSessionWorktree } = await import('../session-worktree-prune')

function deps(refs: SessionWorktreeRef[]) {
  return {
    listWorktreeRefs: vi.fn(async () => refs),
    clearWorktree: vi.fn(async () => {}),
    deleteCheckpoints: vi.fn(async () => {}),
  }
}

describe('pruneSessionWorktree', () => {
  beforeEach(() => {
    deleteRefsMock.mockReset()
    removeGitWorktreeMock.mockReset()
    removeGitWorktreeMock.mockResolvedValue({ ok: true, message: 'removed', path: '/wt/x' })
  })

  it("deletes the session's turn checkpoint anchor refs", async () => {
    /*
     * The refs pin a full tree per turn (untracked files included) and survive worktree
     * removal, branch deletion and `gc --prune=now`. Deleting only the rows leaked those
     * objects into the user's repository forever.
     */
    const d = deps([{ sessionId: 's1', worktreePath: '/wt/x' }])
    await pruneSessionWorktree(
      { sessionId: 's1', projectPath: '/repo', worktreePath: '/wt/x', reason: 'delete' },
      d,
    )
    expect(deleteRefsMock).toHaveBeenCalledWith('/repo', 's1')
  })

  it('deletes anchor refs for a local-mode session, which has no worktree', async () => {
    const d = deps([])
    await pruneSessionWorktree(
      { sessionId: 's1', projectPath: '/repo', worktreePath: null, reason: 'delete' },
      d,
    )
    expect(removeGitWorktreeMock).not.toHaveBeenCalled()
    expect(deleteRefsMock).toHaveBeenCalledWith('/repo', 's1')
  })

  it('removes the worktree when the session solely owns it, then clears + prunes checkpoints', async () => {
    const d = deps([{ sessionId: 's1', worktreePath: '/wt/x' }])
    await pruneSessionWorktree(
      { sessionId: 's1', projectPath: '/repo', worktreePath: '/wt/x', reason: 'delete' },
      d,
    )
    expect(removeGitWorktreeMock).toHaveBeenCalledWith('/repo', { path: '/wt/x' })
    expect(d.clearWorktree).toHaveBeenCalledWith('s1')
    expect(d.deleteCheckpoints).toHaveBeenCalledWith('s1')
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

  it('only prunes checkpoints when the session has no worktree', async () => {
    const d = deps([])
    await pruneSessionWorktree(
      { sessionId: 's1', projectPath: '/repo', worktreePath: null, reason: 'delete' },
      d,
    )
    expect(removeGitWorktreeMock).not.toHaveBeenCalled()
    expect(d.clearWorktree).not.toHaveBeenCalled()
    expect(d.deleteCheckpoints).toHaveBeenCalledWith('s1')
  })

  it('never throws when removal fails', async () => {
    removeGitWorktreeMock.mockResolvedValue({ ok: false, code: 'dirty-worktree', message: 'dirty' })
    const d = deps([{ sessionId: 's1', worktreePath: '/wt/x' }])
    await expect(
      pruneSessionWorktree(
        { sessionId: 's1', projectPath: '/repo', worktreePath: '/wt/x', reason: 'delete' },
        d,
      ),
    ).resolves.toBeUndefined()
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

    await pruneSessionWorktree(
      { sessionId: 's1', projectPath: '/repo', worktreePath: '/wt/x', reason: 'delete' },
      d,
    )

    expect(d.clearWorktree).not.toHaveBeenCalled()
    // Checkpoint rows still go: the session row itself is being deleted or archived.
    expect(d.deleteCheckpoints).toHaveBeenCalledWith('s1')
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

    expect(d.deleteCheckpoints).not.toHaveBeenCalled()
    expect(deleteRefsMock).not.toHaveBeenCalled()
    // The worktree itself still goes: it can be recreated, and the branch keeps its commits.
    expect(removeGitWorktreeMock).toHaveBeenCalledWith('/repo', { path: '/wt/x' })
  })
})
