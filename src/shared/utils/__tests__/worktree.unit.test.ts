import { describe, expect, it } from 'vitest'
import { resolveSessionWorkingDir, sessionWorktreeBranch } from '../worktree'

describe('resolveSessionWorkingDir', () => {
  it('uses the Session worktree path in worktree mode', () => {
    expect(
      resolveSessionWorkingDir(
        { environmentMode: 'worktree', worktreePath: '/wt/session-a' },
        '/repo',
      ),
    ).toBe('/wt/session-a')
  })

  it('uses the opened checkout in local mode', () => {
    expect(
      resolveSessionWorkingDir({ environmentMode: 'local', worktreePath: null }, '/repo'),
    ).toBe('/repo')
  })

  it('falls back to the opened checkout when worktree mode has no path yet', () => {
    expect(
      resolveSessionWorkingDir({ environmentMode: 'worktree', worktreePath: null }, '/repo'),
    ).toBe('/repo')
  })

  it('handles a null session', () => {
    expect(resolveSessionWorkingDir(null, '/repo')).toBe('/repo')
  })
})

describe('sessionWorktreeBranch', () => {
  /**
   * Worktree birth and worktree recreation must derive the SAME branch name, because
   * recreation reattaches the surviving branch to preserve commits made in the old tree.
   * When these drifted (birth from the session id, recreation from the worktree path's
   * last segment) recreation built a divergent branch at the base ref and stranded the
   * session's commit on the orphaned original.
   */
  it('derives the branch from the session id, not the worktree path', () => {
    expect(sessionWorktreeBranch('qa-commit-session')).toBe('ow/session-qa-commi')
  })

  it('is stable for the same session id', () => {
    const sessionId = 'abcdef1234567890'
    expect(sessionWorktreeBranch(sessionId)).toBe(sessionWorktreeBranch(sessionId))
  })

  /*
   * A path-derived name would differ here whenever the recorded directory name is not
   * exactly the session id, which is what broke reattachment.
   */
  it('does not depend on the recorded worktree directory name', () => {
    expect(sessionWorktreeBranch('session-42')).toBe('ow/session-session-')
  })
})
