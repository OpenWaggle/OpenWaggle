import { beforeEach, describe, expect, it, vi } from 'vitest'

const { broadcastMock } = vi.hoisted(() => ({ broadcastMock: vi.fn() }))

vi.mock('../../../utils/broadcast', () => ({
  broadcastToWindows: (channel: string, payload: unknown) => broadcastMock(channel, payload),
}))

import {
  getCachedGitStatus,
  getGitStatusCacheToken,
  invalidateGitStatusCache,
  isSameWorkingTree,
  setCachedGitStatus,
} from '../status-cache'

const TTL_MS = 60_000
const TREE_A = '/repo'
// Session worktrees live under ~/.openwaggle/worktrees/<repo>/<sessionId>, outside
// the checkout, which is what makes prefix-based alias matching safe.
const TREE_B = '/home/dev/.openwaggle/worktrees/repo/session-1'

function status(branch: string) {
  return {
    branch,
    additions: 0,
    deletions: 0,
    filesChanged: 0,
    changedFiles: [],
    clean: true,
    ahead: 0,
    behind: 0,
  }
}

function cache(workingPath: string, branch: string) {
  setCachedGitStatus(workingPath, status(branch), getGitStatusCacheToken(workingPath))
}

describe('git status cache invalidation', () => {
  beforeEach(() => {
    broadcastMock.mockClear()
    invalidateGitStatusCache()
    broadcastMock.mockClear()
  })

  /**
   * The reason invalidation is path-scoped: staging in one session's worktree used to
   * wipe the whole cache, so every other open session re-ran a full `git diff` for a
   * change that never touched it.
   */
  it('invalidates only the named working tree', () => {
    cache(TREE_A, 'main')
    cache(TREE_B, 'feature')

    invalidateGitStatusCache(TREE_B)

    expect(getCachedGitStatus(TREE_A, TTL_MS)?.branch).toBe('main')
    expect(getCachedGitStatus(TREE_B, TTL_MS)).toBeNull()
  })

  it('broadcasts the changed path so other windows converge', () => {
    invalidateGitStatusCache(TREE_B)

    expect(broadcastMock).toHaveBeenCalledWith('git:working-tree-changed', {
      workingPath: TREE_B,
    })
  })

  it('does not broadcast a path when clearing everything', () => {
    cache(TREE_A, 'main')

    invalidateGitStatusCache()

    expect(getCachedGitStatus(TREE_A, TTL_MS)).toBeNull()
    expect(broadcastMock).not.toHaveBeenCalled()
  })

  /**
   * Staging in a subdirectory changes the status reported for the repository root, so
   * a mutation under one alias must invalidate the other. This is what the previous
   * blanket invalidation was covering, and losing it would silently serve stale
   * status after a stage-all issued from a subdirectory.
   */
  it('invalidates a cached ancestor when a subdirectory is mutated', () => {
    cache(TREE_A, 'main')

    invalidateGitStatusCache(`${TREE_A}/src/feature`)

    expect(getCachedGitStatus(TREE_A, TTL_MS)).toBeNull()
  })

  it('leaves a sibling worktree alone', () => {
    cache(TREE_A, 'main')
    cache(TREE_B, 'feature')

    invalidateGitStatusCache(`${TREE_A}/src`)

    // TREE_B is a linked worktree living outside the checkout, so it is untouched.
    expect(getCachedGitStatus(TREE_B, TTL_MS)?.branch).toBe('feature')
  })

  it('does not treat a same-prefix sibling directory as the same tree', () => {
    expect(isSameWorkingTree('/repo2', '/repo')).toBe(false)
    expect(isSameWorkingTree('/repo/src', '/repo')).toBe(true)
    expect(isSameWorkingTree('/repo', '/repo/src')).toBe(true)
    expect(isSameWorkingTree('/repo/', '/repo')).toBe(true)
  })

  // A response that started before an invalidation must not be written back
  // afterwards, or the cache would resurrect state the mutation just invalidated.
  it('drops a cache write whose token predates an invalidation', () => {
    const staleToken = getGitStatusCacheToken(TREE_A)
    invalidateGitStatusCache(TREE_A)

    setCachedGitStatus(TREE_A, status('stale'), staleToken)

    expect(getCachedGitStatus(TREE_A, TTL_MS)).toBeNull()
  })
})
