import { describe, expect, it } from 'vitest'
import { branchFailure, mapBranchFailure } from '../branch-failures'

describe('branchFailure', () => {
  it('builds a failed branch mutation result', () => {
    expect(branchFailure('invalid-name', 'Branch name is invalid.')).toEqual({
      ok: false,
      code: 'invalid-name',
      message: 'Branch name is invalid.',
    })
  })
})

describe('mapBranchFailure', () => {
  it.each([
    ['fatal: not a git repository', 'not-git-repo'],
    ['fatal: a branch named feature already exists', 'branch-exists'],
    ['fatal: the requested upstream branch does not exist', 'upstream-not-found'],
    ['error: pathspec fix did not match any file(s) known to git', 'branch-not-found'],
    ['error: Your local changes would be overwritten by checkout', 'dirty-worktree'],
    ['fatal: not a valid object name: bad name', 'invalid-name'],
    ['error: cannot delete branch main checked out at repo', 'unknown'],
  ])('maps %s to %s', (stderr, code) => {
    expect(mapBranchFailure(stderr).code).toBe(code)
  })

  it('preserves unknown stderr and falls back when stderr is blank', () => {
    expect(mapBranchFailure('fatal: custom failure')).toEqual({
      ok: false,
      code: 'unknown',
      message: 'fatal: custom failure',
    })
    expect(mapBranchFailure('   ')).toEqual({
      ok: false,
      code: 'unknown',
      message: 'Git branch operation failed.',
    })
  })
})
