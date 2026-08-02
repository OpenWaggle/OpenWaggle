import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionWorktreeRef } from '../worktree-cleanup'

const { removeGitWorktreeMock } = vi.hoisted(() => ({
  removeGitWorktreeMock: vi.fn(async () => ({ ok: true, message: 'removed', path: '/wt/x' })),
}))

vi.mock('../worktree-service', () => ({ removeGitWorktree: removeGitWorktreeMock }))

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
    removeGitWorktreeMock.mockReset()
    removeGitWorktreeMock.mockResolvedValue({ ok: true, message: 'removed', path: '/wt/x' })
  })

  it('removes the worktree when the session solely owns it, then clears + prunes checkpoints', async () => {
    const d = deps([{ sessionId: 's1', worktreePath: '/wt/x' }])
    await pruneSessionWorktree({ sessionId: 's1', projectPath: '/repo', worktreePath: '/wt/x' }, d)
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
      { sessionId: 's1', projectPath: '/repo', worktreePath: '/wt/shared' },
      d,
    )
    expect(removeGitWorktreeMock).not.toHaveBeenCalled()
    expect(d.clearWorktree).toHaveBeenCalledWith('s1')
  })

  it('only prunes checkpoints when the session has no worktree', async () => {
    const d = deps([])
    await pruneSessionWorktree({ sessionId: 's1', projectPath: '/repo', worktreePath: null }, d)
    expect(removeGitWorktreeMock).not.toHaveBeenCalled()
    expect(d.clearWorktree).not.toHaveBeenCalled()
    expect(d.deleteCheckpoints).toHaveBeenCalledWith('s1')
  })

  it('never throws when removal fails', async () => {
    removeGitWorktreeMock.mockResolvedValue({ ok: false, code: 'dirty-worktree', message: 'dirty' })
    const d = deps([{ sessionId: 's1', worktreePath: '/wt/x' }])
    await expect(
      pruneSessionWorktree({ sessionId: 's1', projectPath: '/repo', worktreePath: '/wt/x' }, d),
    ).resolves.toBeUndefined()
    expect(d.clearWorktree).toHaveBeenCalledWith('s1')
  })
})
