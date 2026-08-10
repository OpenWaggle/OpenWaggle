import { describe, expect, it } from 'vitest'
import { resolveSessionWorkingDir } from '../worktree'

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
