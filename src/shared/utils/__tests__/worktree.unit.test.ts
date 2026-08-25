import { describe, expect, it } from 'vitest'
import {
  legacySessionWorktreeBranch,
  resolveSessionWorkingDir,
  sessionWorktreeBranch,
} from '../worktree'

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
    expect(sessionWorktreeBranch('qa-commit-session')).toBe('ow/session-qa-commit-session')
  })

  /*
   * The branch used to be the first 8 characters of the session id. Those are the top bits of
   * a UUIDv7 millisecond timestamp, so they only change about once every 65 seconds: two
   * sessions created in the same bucket collided on one branch, which either blocked the
   * second session or handed it the first session's commits. Keep this pinned to the full id.
   */
  it('does not collide for session ids that share a UUIDv7 timestamp prefix', () => {
    const first = '01a014fc-7ee0-71da-bfa9-95f630d6fa24'
    const second = '01a014fc-a5f0-7247-8c8d-fe017fdde16a'
    expect(sessionWorktreeBranch(first)).not.toBe(sessionWorktreeBranch(second))
    // The legacy convention is retained only to reattach older branches, and it does collide.
    expect(legacySessionWorktreeBranch(first)).toBe(legacySessionWorktreeBranch(second))
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
    expect(sessionWorktreeBranch('session-42')).toBe('ow/session-session-42')
  })
})
