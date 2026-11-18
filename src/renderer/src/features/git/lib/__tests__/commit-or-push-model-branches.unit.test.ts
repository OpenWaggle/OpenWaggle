import type { GitBranchInfo } from '@shared/types/git'
import { describe, expect, it } from 'vitest'
import { branchInfoName, findBranchRefConflict } from '../commit-or-push-model'

const slashRemoteBranch = {
  name: 'team/fork/feature',
  localName: 'feature',
  fullName: 'refs/remotes/team/fork/feature',
  isCurrent: false,
  isRemote: true,
  upstream: null,
  ahead: 0,
  behind: 0,
} satisfies GitBranchInfo

describe('commit command branch names', () => {
  it('uses the local name resolved by main instead of guessing the remote boundary', () => {
    expect(branchInfoName(slashRemoteBranch)).toBe('feature')
    expect(findBranchRefConflict([slashRemoteBranch], 'feature')).toBe('feature')
  })
})
